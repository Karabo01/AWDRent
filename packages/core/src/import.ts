import { randomUUID } from "node:crypto";
import { schema, withAgency } from "@awdrent/db";
import { parse } from "csv-parse/sync";
import { inArray, sql } from "drizzle-orm";
import { audit } from "./audit";
import { normaliseIdentifier } from "./crypto";
import { claimImportedReference, nextEftReference, normaliseImportedReference } from "./eft";
import { leaseCreateSchema, syncUnitStatus } from "./leases";
import { ownerBankSchema, ownerBankValues, ownerInsertValues, ownerSchema } from "./owners";
import { type Actor, authorise } from "./portfolio";
import { propertySchema, unitSchema } from "./properties";
import { tenantInsertValues, tenantSchema } from "./tenants";

// CSV import of an agency's existing spreadsheets (decision D26).
//
// Five files linked by the agency's own reference codes. check() validates
// everything with the same rules as the forms and writes nothing; run()
// checks again and imports all rows in one transaction, or none.
// Templates and column descriptions: docs/import-template.md.

export const IMPORT_FILES = ["owners", "properties", "units", "tenants", "leases"] as const;
export type ImportFile = (typeof IMPORT_FILES)[number];
export type ImportFiles = Partial<Record<ImportFile, string>>;

export const IMPORT_COLUMNS: Record<ImportFile, { required: string[]; optional: string[] }> = {
  owners: {
    required: ["owner_ref", "name", "commission_percent"],
    optional: [
      "kind",
      "id_or_reg_no",
      "email",
      "phone",
      "postal_address",
      "vat_registered",
      "vat_number",
      "bank_name",
      "bank_branch_code",
      "bank_account_holder",
      "bank_account_no",
      "notes",
    ],
  },
  properties: {
    required: ["property_ref", "owner_ref", "name", "address_line1", "city"],
    optional: ["type", "address_line2", "suburb", "province", "postal_code", "notes"],
  },
  units: { required: ["property_ref", "unit_label"], optional: ["bedrooms", "bathrooms", "status", "notes"] },
  tenants: {
    required: ["tenant_ref", "full_name"],
    optional: [
      "id_kind",
      "id_number",
      "email",
      "phone",
      "employer",
      "emergency_contact_name",
      "emergency_contact_phone",
      "consent_given",
      "email_opt_in",
      "sms_opt_in",
      "whatsapp_opt_in",
      "notes",
    ],
  },
  leases: {
    required: ["property_ref", "unit_label", "primary_tenant_ref", "status", "start_date", "rent", "due_day"],
    optional: [
      "co_tenant_refs",
      "eft_reference",
      "end_date",
      "deposit",
      "escalation_percent",
      "escalation_date",
      "notice_days",
      "notes",
    ],
  },
};

export const MAX_ROWS_PER_FILE = 5000;
const LEASE_STATUSES = ["draft", "active", "notice_given", "ended"] as const;

export interface RowIssue {
  file: ImportFile;
  /** Spreadsheet row number (the header is row 1). 0 = the whole file. */
  row: number;
  column?: string;
  message: string;
}

export interface ImportReport {
  ok: boolean;
  counts: Record<ImportFile, number>;
  errors: RowIssue[];
  warnings: RowIssue[];
}

export class ImportInvalidError extends Error {
  constructor(public report: ImportReport) {
    super("The import has errors");
  }
}

type Row = Record<string, string>;

// ─── parsing helpers ─────────────────────────────────────────────────

/** Excel in South Africa often saves CSV with semicolons; detect from the header. */
export function parseCsv(text: string): Row[] {
  const clean = text.replace(/^﻿/, "");
  const header = clean.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (header.match(/;/g)?.length ?? 0) > (header.match(/,/g)?.length ?? 0) ? ";" : ",";
  return parse(clean, {
    delimiter,
    columns: (h: string[]) => h.map((c) => c.trim().toLowerCase().replace(/[\s-]+/g, "_")),
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as Row[];
}

/** "2026-11-01", "01/11/2026" or "1/11/2026" (day first) → "2026-11-01". Anything else is returned unchanged for the schema to reject. */
export function normaliseDate(value: string | undefined): string {
  const v = (value ?? "").trim();
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}`;
  return v;
}

function yes(value: string | undefined): boolean {
  return /^(y|yes|true|1|ja)$/i.test((value ?? "").trim());
}

const bool = (value: string | undefined) => (yes(value) ? "true" : "false");
const check = (value: string | undefined) => (yes(value) ? "on" : undefined);

/** zod issues → row issues, naming the CSV column the user should look at. */
function issues(file: ImportFile, row: number, error: { issues: { path: PropertyKey[]; message: string }[] }, columnFor: (field: string) => string) {
  return error.issues.map((i) => ({ file, row, column: columnFor(String(i.path[0] ?? "")), message: i.message }));
}

const snake = (field: string) => field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

// ─── validation ──────────────────────────────────────────────────────

interface Plan {
  owners: { ref: string; values: ReturnType<typeof ownerInsertValues> & Partial<ReturnType<typeof ownerBankValues>> }[];
  properties: { ref: string; ownerRef: string; values: Omit<import("./properties").PropertyInput, "ownerId"> }[];
  units: { key: string; propertyRef: string; values: import("./properties").UnitInput }[];
  tenants: { ref: string; values: ReturnType<typeof tenantInsertValues> }[];
  leases: {
    row: number;
    unitKey: string;
    primaryRef: string;
    coRefs: string[];
    eftReference: string | null;
    status: (typeof LEASE_STATUSES)[number];
    values: {
      startDate: string;
      endDate: string | null;
      rentCents: number;
      dueDay: number;
      depositCents: number;
      escalationBps: number | null;
      escalationDate: string | null;
      noticeDays: number;
      notes: string | null;
    };
  }[];
}

const unitKey = (propertyRef: string, label: string) => `${propertyRef.toLowerCase()}::${label.trim().toLowerCase()}`;

function readFiles(files: ImportFiles, errors: RowIssue[]): Record<ImportFile, Row[]> {
  const out = {} as Record<ImportFile, Row[]>;
  for (const file of IMPORT_FILES) {
    out[file] = [];
    const text = files[file];
    if (!text?.trim()) continue;
    let rows: Row[];
    try {
      rows = parseCsv(text);
    } catch (err) {
      errors.push({ file, row: 0, message: `Could not read the file: ${(err as Error).message}` });
      continue;
    }
    if (rows.length > MAX_ROWS_PER_FILE) {
      errors.push({ file, row: 0, message: `At most ${MAX_ROWS_PER_FILE} rows per file. Split the file and import in parts.` });
      continue;
    }
    const present = new Set(Object.keys(rows[0] ?? {}));
    const missing = IMPORT_COLUMNS[file].required.filter((c) => !present.has(c));
    if (rows.length && missing.length) {
      errors.push({ file, row: 1, message: `Missing column(s): ${missing.join(", ")}` });
      continue;
    }
    const known = new Set([...IMPORT_COLUMNS[file].required, ...IMPORT_COLUMNS[file].optional]);
    const unknown = [...present].filter((c) => !known.has(c));
    if (unknown.length) errors.push({ file, row: 1, message: `Unknown column(s): ${unknown.join(", ")}. Check the template.` });
    out[file] = rows;
  }
  return out;
}

function uniqueRef(file: ImportFile, column: string, row: number, ref: string, seen: Set<string>, errors: RowIssue[]): boolean {
  if (!ref) {
    errors.push({ file, row, column, message: "Required" });
    return false;
  }
  const key = ref.toLowerCase();
  if (seen.has(key)) {
    errors.push({ file, row, column, message: `"${ref}" appears more than once` });
    return false;
  }
  seen.add(key);
  return true;
}

async function buildPlan(actor: Actor, files: ImportFiles): Promise<{ plan: Plan; report: ImportReport }> {
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  const rows = readFiles(files, errors);
  const plan: Plan = { owners: [], properties: [], units: [], tenants: [], leases: [] };
  const agencyId = actor.ctx.agencyId;

  // Owners
  const ownerRefs = new Set<string>();
  const ownerIdIndexes = new Map<string, number>();
  rows.owners.forEach((r, i) => {
    const row = i + 2;
    if (!uniqueRef("owners", "owner_ref", row, r.owner_ref ?? "", ownerRefs, errors)) return;
    const kind = (r.kind || "individual").toLowerCase();
    const idOrRegNo = r.id_or_reg_no ?? "";
    const parsed = ownerSchema.safeParse({
      kind,
      name: r.name ?? "",
      idKind: kind === "individual" && /^\d{13}$/.test(normaliseIdentifier(idOrRegNo)) ? "sa_id" : "other",
      idOrRegNo,
      email: r.email ?? "",
      phone: r.phone ?? "",
      postalAddress: r.postal_address ?? "",
      commissionPercent: r.commission_percent ?? "",
      vatRegistered: bool(r.vat_registered),
      vatNumber: r.vat_number ?? "",
      notes: r.notes ?? "",
    });
    if (!parsed.success) {
      errors.push(...issues("owners", row, parsed.error, (f) => (f === "commissionPercent" ? "commission_percent" : snake(f))));
      return;
    }
    let bank = {};
    if (r.bank_name || r.bank_branch_code || r.bank_account_holder || r.bank_account_no) {
      const b = ownerBankSchema.safeParse({
        bankName: r.bank_name ?? "",
        bankBranchCode: r.bank_branch_code ?? "",
        bankAccountHolder: r.bank_account_holder ?? "",
        bankAccountNo: r.bank_account_no ?? "",
      });
      if (!b.success) {
        errors.push(...issues("owners", row, b.error, snake));
        return;
      }
      bank = ownerBankValues(agencyId, b.data);
    }
    const values = { ...ownerInsertValues(agencyId, parsed.data), ...bank };
    if (values.idOrRegNoBlindIndex) {
      const earlier = ownerIdIndexes.get(values.idOrRegNoBlindIndex);
      if (earlier) warnings.push({ file: "owners", row, column: "id_or_reg_no", message: `Same ID/registration number as row ${earlier}` });
      ownerIdIndexes.set(values.idOrRegNoBlindIndex, row);
    }
    plan.owners.push({ ref: r.owner_ref!, values });
  });

  // Properties
  const propertyRefs = new Set<string>();
  rows.properties.forEach((r, i) => {
    const row = i + 2;
    if (!uniqueRef("properties", "property_ref", row, r.property_ref ?? "", propertyRefs, errors)) return;
    if (!ownerRefs.has((r.owner_ref ?? "").toLowerCase())) {
      errors.push({ file: "properties", row, column: "owner_ref", message: `No owner "${r.owner_ref ?? ""}" in owners.csv` });
      return;
    }
    const parsed = propertySchema.safeParse({
      ownerId: randomUUID(),
      name: r.name ?? "",
      type: (r.type || "house").toLowerCase(),
      addressLine1: r.address_line1 ?? "",
      addressLine2: r.address_line2 ?? "",
      suburb: r.suburb ?? "",
      city: r.city ?? "",
      province: r.province ?? "",
      postalCode: r.postal_code ?? "",
      notes: r.notes ?? "",
    });
    if (!parsed.success) {
      errors.push(...issues("properties", row, parsed.error, (f) => (f === "addressLine1" ? "address_line1" : f === "addressLine2" ? "address_line2" : snake(f))));
      return;
    }
    const { ownerId: _ignored, ...values } = parsed.data;
    plan.properties.push({ ref: r.property_ref!, ownerRef: r.owner_ref!, values });
  });

  // Units
  const unitKeys = new Set<string>();
  rows.units.forEach((r, i) => {
    const row = i + 2;
    const propertyRef = r.property_ref ?? "";
    if (!propertyRefs.has(propertyRef.toLowerCase())) {
      errors.push({ file: "units", row, column: "property_ref", message: `No property "${propertyRef}" in properties.csv` });
      return;
    }
    const key = unitKey(propertyRef, r.unit_label ?? "");
    if (unitKeys.has(key)) {
      errors.push({ file: "units", row, column: "unit_label", message: `"${r.unit_label}" appears twice for this property` });
      return;
    }
    unitKeys.add(key);
    const parsed = unitSchema.safeParse({
      label: r.unit_label ?? "",
      bedrooms: r.bedrooms ?? "",
      bathrooms: r.bathrooms ?? "",
      status: (r.status || "vacant").toLowerCase().replace(/\s+/g, "_"),
      notes: r.notes ?? "",
    });
    if (!parsed.success) {
      errors.push(...issues("units", row, parsed.error, (f) => (f === "label" ? "unit_label" : snake(f))));
      return;
    }
    plan.units.push({ key, propertyRef, values: parsed.data });
  });

  // Tenants
  const tenantRefs = new Set<string>();
  const tenantIdIndexes = new Map<string, number>();
  rows.tenants.forEach((r, i) => {
    const row = i + 2;
    if (!uniqueRef("tenants", "tenant_ref", row, r.tenant_ref ?? "", tenantRefs, errors)) return;
    const parsed = tenantSchema.safeParse({
      fullName: r.full_name ?? "",
      idKind: /^passport$/i.test(r.id_kind ?? "") ? "passport" : "sa_id",
      idNumber: r.id_number ?? "",
      email: r.email ?? "",
      phone: r.phone ?? "",
      employer: r.employer ?? "",
      emergencyContactName: r.emergency_contact_name ?? "",
      emergencyContactPhone: r.emergency_contact_phone ?? "",
      consentGiven: check(r.consent_given),
      emailOptIn: check(r.email_opt_in),
      smsOptIn: check(r.sms_opt_in),
      whatsappOptIn: check(r.whatsapp_opt_in),
      notes: r.notes ?? "",
    });
    if (!parsed.success) {
      errors.push(...issues("tenants", row, parsed.error, snake));
      return;
    }
    if (!parsed.data.consentGiven) {
      warnings.push({ file: "tenants", row, column: "consent_given", message: "No POPIA consent recorded; record it before sending messages" });
    }
    const values = tenantInsertValues(agencyId, parsed.data);
    if (values.idNumberBlindIndex) {
      const earlier = tenantIdIndexes.get(values.idNumberBlindIndex);
      if (earlier) warnings.push({ file: "tenants", row, column: "id_number", message: `Same ID number as row ${earlier}` });
      tenantIdIndexes.set(values.idNumberBlindIndex, row);
    }
    plan.tenants.push({ ref: r.tenant_ref!, values });
  });

  // Leases
  const eftRefs = new Map<string, number>();
  rows.leases.forEach((r, i) => {
    const row = i + 2;
    const key = unitKey(r.property_ref ?? "", r.unit_label ?? "");
    if (!unitKeys.has(key)) {
      errors.push({ file: "leases", row, column: "unit_label", message: `No unit "${r.unit_label ?? ""}" at property "${r.property_ref ?? ""}" in units.csv` });
      return;
    }
    const primaryRef = r.primary_tenant_ref ?? "";
    const coRefs = (r.co_tenant_refs ?? "").split(/[;|]/).map((s) => s.trim()).filter(Boolean);
    const missingTenants = [primaryRef, ...coRefs].filter((ref) => !tenantRefs.has(ref.toLowerCase()));
    if (missingTenants.length) {
      errors.push({ file: "leases", row, column: "primary_tenant_ref", message: `No tenant(s) ${missingTenants.map((t) => `"${t}"`).join(", ")} in tenants.csv` });
      return;
    }
    const status = (r.status ?? "").toLowerCase().replace(/\s+/g, "_");
    if (!(LEASE_STATUSES as readonly string[]).includes(status)) {
      errors.push({ file: "leases", row, column: "status", message: `Use one of: ${LEASE_STATUSES.join(", ")}` });
      return;
    }
    let eftReference: string | null = null;
    if (r.eft_reference?.trim()) {
      eftReference = normaliseImportedReference(r.eft_reference);
      if (!eftReference) {
        errors.push({ file: "leases", row, column: "eft_reference", message: "Use 3–20 letters, digits or dashes" });
        return;
      }
      const earlier = eftRefs.get(eftReference);
      if (earlier) {
        errors.push({ file: "leases", row, column: "eft_reference", message: `${eftReference} is also used on row ${earlier}` });
        return;
      }
      eftRefs.set(eftReference, row);
    }
    const parsed = leaseCreateSchema.safeParse({
      unitId: randomUUID(),
      primaryTenantId: randomUUID(),
      coTenantIds: [],
      startDate: normaliseDate(r.start_date),
      endDate: normaliseDate(r.end_date),
      rent: r.rent ?? "",
      dueDay: r.due_day ?? "",
      deposit: r.deposit || "0",
      escalationPercent: r.escalation_percent ?? "",
      escalationDate: normaliseDate(r.escalation_date),
      noticeDays: r.notice_days || "30",
      notes: r.notes ?? "",
    });
    if (!parsed.success) {
      errors.push(...issues("leases", row, parsed.error, (f) => (f === "escalationPercent" ? "escalation_percent" : snake(f))));
      return;
    }
    const d = parsed.data;
    plan.leases.push({
      row,
      unitKey: key,
      primaryRef,
      coRefs: coRefs.filter((c) => c.toLowerCase() !== primaryRef.toLowerCase()),
      eftReference,
      status: status as (typeof LEASE_STATUSES)[number],
      values: {
        startDate: d.startDate,
        endDate: d.endDate,
        rentCents: d.rent,
        dueDay: d.dueDay,
        depositCents: d.deposit,
        escalationBps: d.escalationPercent,
        escalationDate: d.escalationDate,
        noticeDays: d.noticeDays,
        notes: d.notes,
      },
    });
  });

  // Two live leases on one unit for overlapping dates (D19)
  const live = plan.leases.filter((l) => l.status === "active" || l.status === "notice_given");
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]!;
      const b = live[j]!;
      if (a.unitKey !== b.unitKey) continue;
      const aEnd = a.values.endDate ?? "9999-12-31";
      const bEnd = b.values.endDate ?? "9999-12-31";
      if (a.values.startDate <= bEnd && b.values.startDate <= aEnd) {
        errors.push({ file: "leases", row: b.row, message: `Overlaps the live lease on row ${a.row} for the same unit` });
      }
    }
  }

  // Against what the agency already has
  await withAgency({ ...actor.ctx, readOnly: true }, async (tx) => {
    const refs = [...eftRefs.keys()];
    if (refs.length) {
      const taken = await tx
        .select({ ref: schema.leases.eftReference })
        .from(schema.leases)
        .where(inArray(schema.leases.eftReference, refs));
      for (const t of taken) errors.push({ file: "leases", row: eftRefs.get(t.ref)!, column: "eft_reference", message: `${t.ref} is already used by a lease` });
    }
    const ownerIdx = [...ownerIdIndexes.keys()];
    if (ownerIdx.length) {
      const dup = await tx
        .select({ idx: schema.owners.idOrRegNoBlindIndex, name: schema.owners.name })
        .from(schema.owners)
        .where(inArray(schema.owners.idOrRegNoBlindIndex, ownerIdx));
      for (const d of dup) warnings.push({ file: "owners", row: ownerIdIndexes.get(d.idx!)!, column: "id_or_reg_no", message: `An owner with this number already exists (${d.name})` });
    }
    const tenantIdx = [...tenantIdIndexes.keys()];
    if (tenantIdx.length) {
      const dup = await tx
        .select({ idx: schema.tenants.idNumberBlindIndex, name: schema.tenants.fullName })
        .from(schema.tenants)
        .where(inArray(schema.tenants.idNumberBlindIndex, tenantIdx));
      for (const d of dup) warnings.push({ file: "tenants", row: tenantIdIndexes.get(d.idx!)!, column: "id_number", message: `A tenant with this ID number already exists (${d.name})` });
    }
  });

  const counts = Object.fromEntries(IMPORT_FILES.map((f) => [f, plan[f].length])) as Record<ImportFile, number>;
  const sort = (x: RowIssue[]) => x.sort((p, q) => IMPORT_FILES.indexOf(p.file) - IMPORT_FILES.indexOf(q.file) || p.row - q.row);
  return { plan, report: { ok: errors.length === 0, counts, errors: sort(errors), warnings: sort(warnings) } };
}

/** Validates the files and reports, without writing anything. */
export async function checkImport(actor: Actor, files: ImportFiles): Promise<ImportReport> {
  authorise(actor, "import.run");
  return (await buildPlan(actor, files)).report;
}

/**
 * Validates again and imports everything in one transaction. Throws
 * ImportInvalidError (nothing written) if any row has an error.
 */
export async function runImport(actor: Actor, files: ImportFiles, fileNames: string[]): Promise<ImportReport> {
  authorise(actor, "import.run");
  const { plan, report } = await buildPlan(actor, files);
  if (!report.ok) {
    await recordFailure(
      actor,
      fileNames,
      report.counts,
      report.errors.map(({ file, row, column }) => ({ file, row, column })),
    );
    throw new ImportInvalidError(report);
  }
  try {
    await withAgency(actor.ctx, async (tx) => {
      const ownerIds = new Map<string, string>();
      for (const o of plan.owners) {
        const [row] = await tx.insert(schema.owners).values(o.values).returning({ id: schema.owners.id });
        ownerIds.set(o.ref.toLowerCase(), row!.id);
      }
      const propertyIds = new Map<string, string>();
      for (const p of plan.properties) {
        const [row] = await tx
          .insert(schema.properties)
          .values({ ...p.values, ownerId: ownerIds.get(p.ownerRef.toLowerCase())! })
          .returning({ id: schema.properties.id });
        propertyIds.set(p.ref.toLowerCase(), row!.id);
      }
      const unitIds = new Map<string, string>();
      for (const u of plan.units) {
        const [row] = await tx
          .insert(schema.units)
          .values({ ...u.values, propertyId: propertyIds.get(u.propertyRef.toLowerCase())! })
          .returning({ id: schema.units.id });
        unitIds.set(u.key, row!.id);
      }
      const tenantIds = new Map<string, string>();
      for (const t of plan.tenants) {
        const [row] = await tx.insert(schema.tenants).values(t.values).returning({ id: schema.tenants.id });
        tenantIds.set(t.ref.toLowerCase(), row!.id);
      }
      // Imported references first, so generated ones skip past them (D4)
      for (const l of plan.leases) if (l.eftReference) await claimImportedReference(tx, actor.ctx.agencyId, l.eftReference);
      const touchedUnits = new Set<string>();
      for (const l of plan.leases) {
        const unitId = unitIds.get(l.unitKey)!;
        const eftReference = l.eftReference ?? (await nextEftReference(tx, actor.ctx.agencyId));
        const [lease] = await tx
          .insert(schema.leases)
          .values({ ...l.values, unitId, eftReference, status: l.status })
          .returning();
        await tx.insert(schema.leaseTenants).values([
          { leaseId: lease!.id, tenantId: tenantIds.get(l.primaryRef.toLowerCase())!, isPrimary: true },
          ...l.coRefs.map((ref) => ({ leaseId: lease!.id, tenantId: tenantIds.get(ref.toLowerCase())!, isPrimary: false })),
        ]);
        await tx.insert(schema.leaseEvents).values({
          leaseId: lease!.id,
          type: "created",
          effectiveDate: l.values.startDate,
          note: "Imported from spreadsheet",
          after: { status: l.status, ...l.values },
        });
        touchedUnits.add(unitId);
      }
      for (const unitId of touchedUnits) await syncUnitStatus(tx, unitId);
      await audit(tx, { action: "import.completed", entity: "import", after: { counts: report.counts, files: fileNames } });
      await tx.insert(schema.importJobs).values({ status: "completed", fileNames, counts: report.counts });
    });
  } catch (err) {
    const message = (err as { cause?: { message?: string } }).cause?.message ?? (err as Error).message;
    await recordFailure(actor, fileNames, report.counts, [{ message }]);
    throw err;
  }
  return report;
}

/** Keeps a record of a failed attempt. Messages name files, rows and columns, not cell values. */
async function recordFailure(actor: Actor, fileNames: string[], counts: Record<ImportFile, number>, errors: unknown[]) {
  await withAgency(actor.ctx, (tx) => tx.insert(schema.importJobs).values({ status: "failed", fileNames, counts, errors })).catch(
    (e: unknown) => console.error("[import] could not record the failed import", e),
  );
}

export async function listImports(actor: Actor) {
  authorise(actor, "import.run");
  return withAgency(actor.ctx, (tx) =>
    tx
      .select({ job: schema.importJobs, userName: schema.users.name })
      .from(schema.importJobs)
      .leftJoin(schema.users, sql`${schema.users.id} = ${schema.importJobs.createdBy}`)
      .orderBy(sql`${schema.importJobs.createdAt} desc`)
      .limit(20),
  );
}

const EXAMPLES: Record<ImportFile, Record<string, string>[]> = {
  owners: [
    {
      owner_ref: "O1",
      name: "Thabo Mokoena",
      kind: "individual",
      id_or_reg_no: "8001015009087",
      email: "thabo@example.co.za",
      phone: "082 555 0100",
      commission_percent: "10",
      vat_registered: "no",
      bank_name: "FNB",
      bank_branch_code: "250655",
      bank_account_holder: "T Mokoena",
      bank_account_no: "62001234567",
    },
  ],
  properties: [
    { property_ref: "P1", owner_ref: "O1", name: "12 Oak Street", type: "house", address_line1: "12 Oak Street", suburb: "Melville", city: "Johannesburg", province: "Gauteng", postal_code: "2092" },
  ],
  units: [{ property_ref: "P1", unit_label: "Main house", bedrooms: "3", bathrooms: "2", status: "occupied" }],
  tenants: [
    {
      tenant_ref: "T1",
      full_name: "Ayanda Khumalo",
      id_kind: "sa_id",
      id_number: "9001015009086",
      email: "ayanda@example.co.za",
      phone: "082 555 0101",
      consent_given: "yes",
      email_opt_in: "yes",
      sms_opt_in: "yes",
    },
  ],
  leases: [
    {
      property_ref: "P1",
      unit_label: "Main house",
      primary_tenant_ref: "T1",
      eft_reference: "",
      status: "active",
      start_date: "01/11/2025",
      end_date: "31/10/2026",
      rent: "8500.00",
      due_day: "1",
      deposit: "17000.00",
      escalation_percent: "8",
      escalation_date: "01/11/2026",
      notice_days: "30",
    },
  ],
};

const csvCell = (v: string) => (/[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** A ready-to-fill CSV: every column, with one example row to overwrite. */
export function templateCsv(file: ImportFile): string {
  const columns = [...IMPORT_COLUMNS[file].required, ...IMPORT_COLUMNS[file].optional];
  const rows = EXAMPLES[file].map((r) => columns.map((c) => csvCell(r[c] ?? "")).join(","));
  return `${columns.join(",")}\r\n${rows.join("\r\n")}\r\n`;
}
