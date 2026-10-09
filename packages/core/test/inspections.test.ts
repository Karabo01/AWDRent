import { writeFileSync } from "node:fs";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@awdrent/config";
import { closeDb, schema, withAgency } from "@awdrent/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgencyWithAdmin } from "../../db/test/fixtures";
import { monthStart, todayInSouthAfrica } from "../src/billing";
import { uploadDocument } from "../src/documents";
import { addItem, completeInspection, defaultChecklist, getInspection, InspectionError, saveInspection, startInspection, worse } from "../src/inspections";
import { activateLease, createLease } from "../src/leases";
import { createOwner } from "../src/owners";
import { type Actor, NotFoundError } from "../src/portfolio";
import { createProperty, createUnit } from "../src/properties";
import { inviteStaff } from "../src/staff";
import { readObject } from "../src/storage";
import { createTenant } from "../src/tenants";

const today = todayInSouthAfrica();
const PNG = new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]));
let a: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let adminA: Actor;
let otherAgentA: Actor;
let leaseId: string;

beforeAll(async () => {
  await new S3Client({
    endpoint: env().S3_ENDPOINT,
    region: env().S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env().S3_ACCESS_KEY_ID, secretAccessKey: env().S3_SECRET_ACCESS_KEY },
  })
    .send(new CreateBucketCommand({ Bucket: env().S3_BUCKET }))
    .catch(() => undefined);
  a = await createAgencyWithAdmin("InspA");
  adminA = { ctx: { agencyId: a.agency.id, userId: a.admin.id }, role: "admin", userId: a.admin.id };
  const otherId = await inviteStaff(adminA.ctx, { name: "Other Agent", email: `iother-${Date.now()}@a.test`, role: "agent", phone: null });
  otherAgentA = { ctx: { agencyId: a.agency.id, userId: otherId }, role: "agent", userId: otherId };
  const owner = await createOwner(adminA, {
    kind: "individual",
    name: "Insp Owner",
    idKind: "sa_id",
    idOrRegNo: "",
    email: null,
    phone: null,
    postalAddress: null,
    commissionPercent: null,
    vatRegistered: false,
    vatNumber: null,
    notes: null,
  });
  const property = await createProperty(adminA, {
    ownerId: owner,
    name: "Oak House",
    type: "house",
    addressLine1: "12 Oak Street",
    addressLine2: null,
    suburb: "Melville",
    city: "Johannesburg",
    province: null,
    postalCode: null,
    notes: null,
  });
  const unitId = await createUnit(adminA, property, { label: "Main", bedrooms: 2, bathrooms: 1, status: "vacant", notes: null });
  const tenantId = await createTenant(adminA, {
    fullName: "Ayanda Khumalo",
    idKind: "sa_id",
    idNumber: "",
    email: "ayanda.insp@example.test",
    phone: null,
    employer: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    consentGiven: true,
    emailOptIn: false,
    smsOptIn: false,
    whatsappOptIn: false,
    notes: null,
  });
  const l = await createLease(adminA, {
    unitId,
    primaryTenantId: tenantId,
    coTenantIds: [],
    startDate: monthStart(today),
    billingStartsOn: null,
    endDate: null,
    rent: 850_000,
    dueDay: 1,
    deposit: 0,
    escalationPercent: null,
    escalationDate: null,
    noticeDays: 30,
    notes: null,
  });
  await activateLease(adminA, l.id);
  leaseId = l.id;
});
afterAll(() => closeDb());

describe("inspections", () => {
  it("knows when an item is worse at move-out", () => {
    expect(worse("good", "damaged")).toBe(true);
    expect(worse("fair", "fair")).toBe(false);
    expect(worse("poor", "good")).toBe(false);
    expect(worse("good", "not_applicable")).toBe(false);
  });

  it("records an ingoing inspection room by room, with photos, and files the report", async () => {
    const id = await startInspection(adminA, leaseId, "ingoing", today);
    await expect(startInspection(adminA, leaseId, "ingoing", today)).rejects.toBeInstanceOf(InspectionError);
    let view = await getInspection(adminA, id);
    expect(view.items).toHaveLength(defaultChecklist(2, 1).length);
    expect(view.items.map((i) => i.room)).toContain("Bedroom 2");

    await expect(completeInspection(adminA, id)).rejects.toThrow(/Rate every item first/);
    await addItem(adminA, id, "Kitchen", "Dishwasher");
    view = await getInspection(adminA, id);
    const stove = view.items.find((i) => i.item === "Stove and oven")!;
    await saveInspection(adminA, id, {
      items: view.items.map((i) => ({ id: i.id, condition: i.id === stove.id ? "fair" : "good", notes: i.id === stove.id ? "Back plate scratched" : null })),
      attendees: "Ayanda Khumalo (tenant), Thabo Mokoena (agent)",
    });
    const photo = await uploadDocument(adminA, { subject: { type: "inspection_item", id: stove.id }, kind: "inspection_photo", filename: "stove.png", bytes: PNG });
    // As if the virus scan passed
    await withAgency(adminA.ctx, (tx) => tx.update(schema.documents).set({ status: "clean" }).where(eq(schema.documents.id, photo)));

    const reportId = await completeInspection(adminA, id);
    const [doc] = await withAgency(adminA.ctx, (tx) => tx.select().from(schema.documents).where(eq(schema.documents.id, reportId)));
    expect(doc).toMatchObject({ kind: "inspection_report", leaseId, status: "clean" });
    const pdf = await readObject(doc!.fileKey);
    expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe("%PDF-");
    // Kept for a visual check of the layout
    writeFileSync(`${process.env.TEMP ?? "/tmp"}/awdrent-inspection-sample.pdf`, pdf);
    const [email] = await withAgency(adminA.ctx, (tx) =>
      tx.select().from(schema.messages).where(and(eq(schema.messages.templateKey, "inspection_report"), eq(schema.messages.leaseId, leaseId))),
    );
    // Sent although the tenant has not opted in to email: it is a record they need
    expect(email).toMatchObject({ status: "queued", attachmentDocumentId: reportId });

    // Completed means final, in the service and in the database
    await expect(saveInspection(adminA, id, { items: [{ id: stove.id, condition: "good", notes: null }] })).rejects.toBeInstanceOf(InspectionError);
    await expect(
      withAgency(adminA.ctx, (tx) => tx.update(schema.inspectionItems).set({ condition: "good" }).where(eq(schema.inspectionItems.id, stove.id))),
    ).rejects.toThrow();
  });

  it("starts the outgoing inspection from the ingoing one and flags what got worse", async () => {
    const id = await startInspection(adminA, leaseId, "outgoing", today);
    const view = await getInspection(adminA, id);
    expect(view.items.map((i) => i.item)).toContain("Dishwasher");
    const stove = view.items.find((i) => i.item === "Stove and oven")!;
    expect(stove.ingoing).toEqual({ condition: "fair", notes: "Back plate scratched" });
    await saveInspection(adminA, id, { items: [{ id: stove.id, condition: "damaged", notes: "Oven door glass cracked" }] });
    const after = await getInspection(adminA, id);
    expect(after.items.find((i) => i.id === stove.id)).toMatchObject({ worse: true });
    expect(after.items.filter((i) => i.worse)).toHaveLength(1);
  });

  it("keeps inspections to the lease's portfolio", async () => {
    const [insp] = await withAgency(adminA.ctx, (tx) => tx.select().from(schema.inspections).where(eq(schema.inspections.leaseId, leaseId)));
    await expect(getInspection(otherAgentA, insp!.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
