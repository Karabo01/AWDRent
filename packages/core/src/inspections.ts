import { createHash } from "node:crypto";
import { schema, type Tx, withAgency } from "@awdrent/db";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { audit } from "./audit";
import { send } from "./messages";
import { renderInspectionReport } from "./pdf/inspection";
import { type Actor, assertLeaseInScope, authorise, NotFoundError } from "./portfolio";
import { loadBrand, pdfDate } from "./receipts";
import { putGenerated, readObject } from "./storage";

// Ingoing and outgoing inspections (spec; Rental Housing Act s5; D118–D121).
//   start     a room-by-room checklist from the unit's bedrooms and bathrooms;
//             an outgoing inspection starts from the ingoing one's items, so
//             each item shows its condition at move-in.
//   record    a condition and notes per item, photos per item (virus-scanned).
//   complete  every item rated; the inspection is frozen (database triggers),
//             a branded report is filed with the lease and emailed to the
//             tenants, who have 7 days to raise anything (D120).

export class InspectionError extends Error {}

export const CONDITION_LABEL = { good: "Good", fair: "Fair", poor: "Poor", damaged: "Damaged", missing: "Missing", not_applicable: "N/A" } as const;
type Condition = keyof typeof CONDITION_LABEL;
const RANK: Record<Condition, number | null> = { good: 0, fair: 1, poor: 2, damaged: 3, missing: 4, not_applicable: null };
export const KIND_LABEL = { ingoing: "Ingoing", outgoing: "Outgoing" } as const;
const MAX_REPORT_PHOTOS = 60;

/** True when an item is in a worse state at move-out than at move-in. */
export function worse(ingoing: Condition | null | undefined, outgoing: Condition | null | undefined): boolean {
  const a = ingoing ? RANK[ingoing] : null;
  const b = outgoing ? RANK[outgoing] : null;
  return a !== null && b !== null && b > a;
}

const COMMON = ["Walls", "Ceiling", "Floor", "Windows and glass", "Doors and locks", "Lights and plugs"];

/** The standard checklist for a unit (D118). */
export function defaultChecklist(bedrooms: number, bathrooms: number): { room: string; item: string }[] {
  const rooms: [string, string[]][] = [
    ["Entrance and passage", COMMON],
    ["Lounge", COMMON],
    ["Kitchen", [...COMMON, "Stove and oven", "Sink and taps", "Cupboards and counters"]],
    ...Array.from({ length: Math.max(bedrooms, 1) }, (_, i): [string, string[]] => [`Bedroom ${i + 1}`, [...COMMON, "Built-in cupboards"]]),
    ...Array.from({ length: Math.max(bathrooms, 1) }, (_, i): [string, string[]] => [
      `Bathroom ${i + 1}`,
      [...COMMON, "Toilet", "Basin and taps", "Bath or shower", "Tiles"],
    ]),
    ["Outside", ["Gate and remotes", "Garden", "Garage or parking", "Keys handed over"]],
  ];
  return rooms.flatMap(([room, items]) => items.map((item) => ({ room, item })));
}

async function loadInspection(tx: Tx, actor: Actor, id: string, lock = false) {
  const q = tx.select().from(schema.inspections).where(eq(schema.inspections.id, id));
  const [insp] = lock ? await q.for("update") : await q;
  if (!insp) throw new NotFoundError("Inspection");
  await assertLeaseInScope(tx, actor, insp.leaseId);
  return insp;
}

export async function startInspection(actor: Actor, leaseId: string, kind: "ingoing" | "outgoing", inspectedOn: string): Promise<string> {
  authorise(actor, "inspections.manage");
  return withAgency(actor.ctx, async (tx) => {
    await assertLeaseInScope(tx, actor, leaseId);
    const [existing] = await tx
      .select({ id: schema.inspections.id })
      .from(schema.inspections)
      .where(and(eq(schema.inspections.leaseId, leaseId), eq(schema.inspections.kind, kind)));
    if (existing) throw new InspectionError(`This lease already has an ${kind} inspection.`);
    const [unit] = await tx
      .select({ bedrooms: schema.units.bedrooms, bathrooms: schema.units.bathrooms })
      .from(schema.leases)
      .innerJoin(schema.units, eq(schema.units.id, schema.leases.unitId))
      .where(eq(schema.leases.id, leaseId));
    let items = defaultChecklist(unit?.bedrooms ?? 1, unit?.bathrooms ?? 1);
    if (kind === "outgoing") {
      const [ingoing] = await tx.select({ id: schema.inspections.id }).from(schema.inspections).where(and(eq(schema.inspections.leaseId, leaseId), eq(schema.inspections.kind, "ingoing")));
      if (ingoing) {
        items = await tx
          .select({ room: schema.inspectionItems.room, item: schema.inspectionItems.item })
          .from(schema.inspectionItems)
          .where(eq(schema.inspectionItems.inspectionId, ingoing.id))
          .orderBy(asc(schema.inspectionItems.position));
      }
    }
    const [insp] = await tx.insert(schema.inspections).values({ leaseId, kind, inspectedOn }).returning({ id: schema.inspections.id });
    await tx.insert(schema.inspectionItems).values(items.map((i, position) => ({ inspectionId: insp!.id, position, room: i.room, item: i.item })));
    await audit(tx, { action: "inspection.started", entity: "lease", entityId: leaseId, after: { inspectionId: insp!.id, kind } });
    return insp!.id;
  });
}

export async function listInspections(actor: Actor, leaseId: string) {
  authorise(actor, "inspections.manage");
  return withAgency({ ...actor.ctx, readOnly: true }, async (tx) => {
    await assertLeaseInScope(tx, actor, leaseId);
    return tx.select().from(schema.inspections).where(eq(schema.inspections.leaseId, leaseId)).orderBy(asc(schema.inspections.kind));
  });
}

export async function getInspection(actor: Actor, id: string) {
  authorise(actor, "inspections.manage");
  return withAgency({ ...actor.ctx, readOnly: true }, async (tx) => {
    const insp = await loadInspection(tx, actor, id);
    const items = await tx.select().from(schema.inspectionItems).where(eq(schema.inspectionItems.inspectionId, id)).orderBy(asc(schema.inspectionItems.position));
    const photos = items.length
      ? await tx
          .select({ id: schema.documents.id, itemId: schema.documents.inspectionItemId, filename: schema.documents.filename, status: schema.documents.status })
          .from(schema.documents)
          .where(and(inArray(schema.documents.inspectionItemId, items.map((i) => i.id)), isNull(schema.documents.deletedAt)))
      : [];
    let ingoing = new Map<string, { condition: Condition | null; notes: string | null }>();
    if (insp.kind === "outgoing") {
      const [first] = await tx.select({ id: schema.inspections.id }).from(schema.inspections).where(and(eq(schema.inspections.leaseId, insp.leaseId), eq(schema.inspections.kind, "ingoing")));
      if (first) {
        const before = await tx.select().from(schema.inspectionItems).where(eq(schema.inspectionItems.inspectionId, first.id));
        ingoing = new Map(before.map((b) => [`${b.room}|${b.item}`, { condition: b.condition, notes: b.notes }]));
      }
    }
    return {
      inspection: insp,
      items: items.map((i) => {
        const before = ingoing.get(`${i.room}|${i.item}`) ?? null;
        return { ...i, photos: photos.filter((p) => p.itemId === i.id), ingoing: before, worse: worse(before?.condition, i.condition) };
      }),
    };
  });
}

export const itemsSchema = z.array(
  z.object({
    id: z.uuid(),
    condition: z.enum(["good", "fair", "poor", "damaged", "missing", "not_applicable"]).nullable(),
    notes: z
      .string()
      .trim()
      .max(1000)
      .transform((s) => s || null),
  }),
);

/** Saves conditions and notes (several items at once), and the inspection's details. */
export async function saveInspection(
  actor: Actor,
  id: string,
  input: { items: z.infer<typeof itemsSchema>; inspectedOn?: string; attendees?: string | null; notes?: string | null },
): Promise<void> {
  authorise(actor, "inspections.manage");
  await withAgency(actor.ctx, async (tx) => {
    const insp = await loadInspection(tx, actor, id, true);
    if (insp.status === "completed") throw new InspectionError("This inspection is completed.");
    for (const item of input.items) {
      await tx
        .update(schema.inspectionItems)
        .set({ condition: item.condition, notes: item.notes })
        .where(and(eq(schema.inspectionItems.id, item.id), eq(schema.inspectionItems.inspectionId, id)));
    }
    if (input.inspectedOn !== undefined || input.attendees !== undefined || input.notes !== undefined) {
      await tx
        .update(schema.inspections)
        .set({
          ...(input.inspectedOn ? { inspectedOn: input.inspectedOn } : {}),
          ...(input.attendees !== undefined ? { attendees: input.attendees } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        })
        .where(eq(schema.inspections.id, id));
    }
  });
}

export async function addItem(actor: Actor, id: string, room: string, item: string): Promise<void> {
  authorise(actor, "inspections.manage");
  await withAgency(actor.ctx, async (tx) => {
    const insp = await loadInspection(tx, actor, id, true);
    if (insp.status === "completed") throw new InspectionError("This inspection is completed.");
    const [last] = await tx
      .select({ position: schema.inspectionItems.position })
      .from(schema.inspectionItems)
      .where(eq(schema.inspectionItems.inspectionId, id))
      .orderBy(desc(schema.inspectionItems.position))
      .limit(1);
    await tx.insert(schema.inspectionItems).values({ inspectionId: id, position: (last?.position ?? -1) + 1, room: room.trim().slice(0, 80), item: item.trim().slice(0, 120) });
  });
}

/** Completes the inspection: frozen, report filed with the lease and emailed to the tenants (D120). */
export async function completeInspection(actor: Actor, id: string): Promise<string> {
  authorise(actor, "inspections.manage");
  const agencyId = actor.ctx.agencyId;
  const done = await withAgency(actor.ctx, async (tx) => {
    const insp = await loadInspection(tx, actor, id, true);
    if (insp.status === "completed") throw new InspectionError("This inspection is already completed.");
    const unrated = await tx
      .select({ id: schema.inspectionItems.id })
      .from(schema.inspectionItems)
      .where(and(eq(schema.inspectionItems.inspectionId, id), isNull(schema.inspectionItems.condition)));
    if (unrated.length) throw new InspectionError(`Rate every item first (${unrated.length} still to do; use N/A where it does not apply).`);
    await tx.update(schema.inspections).set({ status: "completed", completedAt: sql`now()`, completedBy: actor.userId }).where(eq(schema.inspections.id, id));
    await audit(tx, { action: "inspection.completed", entity: "lease", entityId: insp.leaseId, after: { inspectionId: id, kind: insp.kind } });
    return insp;
  });
  return fileReport(agencyId, actor, done.id);
}

/** Builds and files the report; sends it to the tenants. Safe to repeat until it has a report. */
async function fileReport(agencyId: string, actor: Actor, id: string): Promise<string> {
  const view = await getInspection(actor, id);
  const insp = view.inspection;
  const facts = await withAgency({ agencyId, readOnly: true }, async (tx) => {
    const [row] = await tx
      .select({ lease: schema.leases, unit: schema.units.label, property: schema.properties })
      .from(schema.leases)
      .innerJoin(schema.units, eq(schema.units.id, schema.leases.unitId))
      .innerJoin(schema.properties, eq(schema.properties.id, schema.units.propertyId))
      .where(eq(schema.leases.id, insp.leaseId));
    const tenants = await tx
      .select({ id: schema.tenants.id, name: schema.tenants.fullName })
      .from(schema.leaseTenants)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.leaseTenants.tenantId))
      .where(eq(schema.leaseTenants.leaseId, insp.leaseId))
      .orderBy(desc(schema.leaseTenants.isPrimary));
    return { ...row!, tenants };
  });
  const p = facts.property;
  const dwelling = [`${facts.unit}, ${p.name}`, p.addressLine1 !== p.name ? p.addressLine1 : null, p.suburb, p.city].filter(Boolean).join(", ");
  const rooms: { room: string; items: { item: string; condition: string; notes: string | null; ingoing: string | null; worse: boolean }[] }[] = [];
  for (const i of view.items) {
    let room = rooms.find((r) => r.room === i.room);
    if (!room) rooms.push((room = { room: i.room, items: [] }));
    room.items.push({
      item: i.item,
      condition: i.condition ? CONDITION_LABEL[i.condition] : "",
      notes: i.notes,
      ingoing: i.ingoing?.condition ? CONDITION_LABEL[i.ingoing.condition] : null,
      worse: i.worse,
    });
  }
  const photos: { caption: string; data: Buffer; format: "png" | "jpg" }[] = [];
  for (const i of view.items) {
    for (const ph of i.photos) {
      if (ph.status !== "clean" || photos.length >= MAX_REPORT_PHOTOS) continue;
      const [doc] = await withAgency({ agencyId, readOnly: true }, (tx) => tx.select().from(schema.documents).where(eq(schema.documents.id, ph.id)));
      if (!doc || (doc.contentType !== "image/png" && doc.contentType !== "image/jpeg")) continue;
      photos.push({ caption: `${i.room}: ${i.item}`, data: Buffer.from(await readObject(doc.fileKey)), format: doc.contentType === "image/png" ? "png" : "jpg" });
    }
  }
  const title = `${KIND_LABEL[insp.kind]} inspection report`;
  const pdf = new Uint8Array(
    await renderInspectionReport(await loadBrand(agencyId), {
      title,
      dwelling,
      eftReference: facts.lease.eftReference,
      tenants: facts.tenants.map((t) => t.name),
      inspectedOn: pdfDate(insp.inspectedOn),
      attendees: insp.attendees,
      notes: insp.notes,
      completedOn: pdfDate(new Date().toISOString().slice(0, 10)),
      outgoing: insp.kind === "outgoing",
      rooms,
      photos,
    }),
  );
  const key = await putGenerated(agencyId, pdf, "application/pdf", "pdf");
  return withAgency(actor.ctx, async (tx) => {
    const [doc] = await tx
      .insert(schema.documents)
      .values({
        leaseId: insp.leaseId,
        kind: "inspection_report",
        filename: `${title} ${facts.lease.eftReference}.pdf`,
        contentType: "application/pdf",
        sizeBytes: pdf.byteLength,
        sha256: createHash("sha256").update(pdf).digest("hex"),
        fileKey: key,
        status: "clean",
        scanResult: "generated",
        scannedAt: sql`now()`,
      })
      .returning({ id: schema.documents.id });
    await tx.update(schema.inspections).set({ reportDocumentId: doc!.id }).where(eq(schema.inspections.id, id));
    for (const t of facts.tenants) {
      await send(tx, {
        recipient: { kind: "tenant", tenantId: t.id },
        templateKey: "inspection_report",
        leaseId: insp.leaseId,
        attachmentDocumentId: doc!.id,
        // A record the tenant needs, so sent whatever their opt-ins (D120)
        transactional: true,
        variables: { name: t.name.split(/\s+/)[0]!, inspection: insp.kind, unit: `${facts.unit}, ${p.name}`, date: pdfDate(insp.inspectedOn) },
      });
    }
    return doc!.id;
  });
}

/** Deletes an inspection still in draft (e.g. started on the wrong lease). */
export async function deleteDraftInspection(actor: Actor, id: string): Promise<void> {
  authorise(actor, "inspections.manage");
  await withAgency(actor.ctx, async (tx) => {
    const insp = await loadInspection(tx, actor, id, true);
    if (insp.status === "completed") throw new InspectionError("A completed inspection cannot be deleted.");
    const items = await tx.select({ id: schema.inspectionItems.id }).from(schema.inspectionItems).where(eq(schema.inspectionItems.inspectionId, id));
    if (items.length) {
      const [photo] = await tx
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(and(inArray(schema.documents.inspectionItemId, items.map((i) => i.id)), isNull(schema.documents.deletedAt)))
        .limit(1);
      if (photo) throw new InspectionError("Delete the photos first.");
    }
    await tx.delete(schema.inspections).where(eq(schema.inspections.id, id));
    await audit(tx, { action: "inspection.deleted", entity: "lease", entityId: insp.leaseId, after: { inspectionId: id, kind: insp.kind } });
  });
}

/** Files the report of a completed inspection that has none (if building it failed at the time). */
export async function fileMissingReport(actor: Actor, id: string): Promise<string> {
  authorise(actor, "inspections.manage");
  const insp = await withAgency({ ...actor.ctx, readOnly: true }, (tx) => loadInspection(tx, actor, id));
  if (insp.status !== "completed" || insp.reportDocumentId) throw new InspectionError("This inspection already has its report, or is not completed.");
  return fileReport(actor.ctx.agencyId, actor, id);
}
