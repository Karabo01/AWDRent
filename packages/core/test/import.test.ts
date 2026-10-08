import { closeDb, schema, withAgency } from "@awdrent/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgencyWithAdmin } from "../../db/test/fixtures";
import { checkImport, ImportInvalidError, type ImportFiles, normaliseDate, parseCsv, runImport } from "../src/import";
import { getLease, listLeases } from "../src/leases";
import { listOwners, revealOwnerBankAccount } from "../src/owners";
import { ForbiddenError } from "../src/permissions";
import type { Actor } from "../src/portfolio";
import { getProperty, listProperties } from "../src/properties";
import { inviteStaff } from "../src/staff";
import { listTenants } from "../src/tenants";

let a: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let b: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let adminA: Actor;
let adminB: Actor;

// An agency's spreadsheet as Excel in South Africa saves it: semicolons,
// day-first dates, decimal commas, a byte-order mark.
const files = (suffix: string, extra: Partial<ImportFiles> = {}): ImportFiles => ({
  owners: `﻿owner_ref;name;kind;id_or_reg_no;email;commission_percent;vat_registered;vat_number;bank_name;bank_branch_code;bank_account_holder;bank_account_no
O1;Thabo Mokoena ${suffix};individual;8001015009087;thabo@example.test;10;no;;FNB;250655;T Mokoena;62001234567
O2;Kaya Holdings ${suffix};company;2015/123456/07;;8,5;yes;4123456789;;;;`,
  properties: `property_ref,owner_ref,name,type,address_line1,suburb,city
P1,O1,Oak House ${suffix},house,12 Oak Street,Melville,Johannesburg
P2,O2,Kaya Court ${suffix},apartment_block,3 Long Street,,Cape Town`,
  units: `property_ref,unit_label,bedrooms,status
P1,Main house,3,vacant
P2,Flat 1,2,vacant
P2,Flat 2,1,vacant`,
  tenants: `tenant_ref,full_name,id_number,phone,email,consent_given,sms_opt_in,email_opt_in
T1,Ayanda Khumalo ${suffix},8001015009087,082 555 0101,ayanda@example.test,yes,yes,yes
T2,Lindiwe Nkosi ${suffix},,083 555 0102,,no,no,no
T3,Sipho Nkosi ${suffix},,,,yes,no,no`,
  leases: `property_ref;unit_label;primary_tenant_ref;co_tenant_refs;eft_reference;status;start_date;end_date;rent;due_day;deposit;escalation_percent;escalation_date
P1;Main house;T1;;;active;01/11/2025;31/10/2026;8 500,00;1;17000;8;01/11/2026
P2;Flat 1;T2;T3;KC-0007;active;2025-03-01;;6200;25;6200;;
P2;Flat 2;T3;;;draft;01/12/2026;30/11/2027;5900;1;0;;`,
  ...extra,
});

beforeAll(async () => {
  a = await createAgencyWithAdmin("ImpA");
  b = await createAgencyWithAdmin("ImpB");
  adminA = { ctx: { agencyId: a.agency.id, userId: a.admin.id }, role: "admin", userId: a.admin.id };
  adminB = { ctx: { agencyId: b.agency.id, userId: b.admin.id }, role: "admin", userId: b.admin.id };
});
afterAll(() => closeDb());

describe("parsing", () => {
  it("handles semicolons, BOMs and South African dates", () => {
    expect(parseCsv("﻿a;b\n1;2\n")).toEqual([{ a: "1", b: "2" }]);
    expect(parseCsv("Owner Ref,Name\nO1,\"Smith, J\"\n")).toEqual([{ owner_ref: "O1", name: "Smith, J" }]);
    expect(normaliseDate("01/11/2025")).toBe("2025-11-01");
    expect(normaliseDate("1/2/2026")).toBe("2026-02-01");
    expect(normaliseDate("2026-02-01")).toBe("2026-02-01");
  });
});

describe("checking", () => {
  it("passes a good set of files without writing anything", async () => {
    const report = await checkImport(adminA, files("check"));
    expect(report.errors).toEqual([]);
    expect(report.counts).toEqual({ owners: 2, properties: 2, units: 3, tenants: 3, leases: 3 });
    expect(report.warnings.map((w) => w.message)).toContain("No POPIA consent recorded; record it before sending messages");
    expect((await listOwners(adminA, { q: "check" })).length).toBe(0);
  });

  it("reports every problem with its file, row and column", async () => {
    const report = await checkImport(
      adminA,
      files("bad", {
        properties: `property_ref,owner_ref,name,address_line1,city
P1,O9,Nowhere,1 Road,Durban
P2,O1,No City,2 Road,`,
        leases: `property_ref,unit_label,primary_tenant_ref,status,start_date,end_date,rent,due_day
P1,Main house,T1,active,2025-01-01,2025-12-31,abc,1
P1,Main house,T1,active,2025-06-01,2026-05-31,9000,40`,
      }),
    );
    expect(report.ok).toBe(false);
    const summary = report.errors.map((e) => `${e.file}:${e.row}:${e.column ?? ""}`);
    expect(summary).toEqual(
      expect.arrayContaining(["properties:2:owner_ref", "properties:3:city", "leases:2:rent", "leases:3:due_day"]),
    );
  });

  it("refuses overlapping live leases and references already in use", async () => {
    const report = await checkImport(
      adminA,
      files("overlap", {
        leases: `property_ref,unit_label,primary_tenant_ref,eft_reference,status,start_date,end_date,rent,due_day
P1,Main house,T1,ZZ-1,active,2025-01-01,2025-12-31,9000,1
P1,Main house,T2,ZZ-2,active,2025-06-01,2026-05-31,9000,1
P2,Flat 1,T3,ZZ-2,draft,2027-01-01,,9000,1`,
      }),
    );
    expect(report.errors.map((e) => e.message)).toEqual(
      expect.arrayContaining(["ZZ-2 is also used on row 3", "Overlaps the live lease on row 2 for the same unit"]),
    );
  });

  it("is for admins only", async () => {
    const agentId = await inviteStaff(adminA.ctx, { name: "Imp Agent", email: `ia-${Date.now()}@a.test`, role: "agent", phone: null });
    await expect(checkImport({ ctx: { agencyId: a.agency.id, userId: agentId }, role: "agent", userId: agentId }, files("x"))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("importing", () => {
  it("creates everything, keeps imported EFT references and numbers the rest after them", async () => {
    await runImport(adminA, files("run"), ["owners.csv", "properties.csv", "units.csv", "tenants.csv", "leases.csv"]);

    const owners = await listOwners(adminA, { q: "run" });
    expect(owners.map((o) => [o.name, o.commissionBps, o.vatRegistered])).toEqual([
      ["Kaya Holdings run", 850, true],
      ["Thabo Mokoena run", 1000, false],
    ]);
    const thabo = owners.find((o) => o.name.startsWith("Thabo"))!;
    expect(thabo.idOrRegNoLast4).toBe("9087");
    expect(await revealOwnerBankAccount(adminA, thabo.id)).toBe("62001234567");

    const leases = await listLeases(adminA, { q: "run" });
    const byTenant = Object.fromEntries(leases.map((l) => [l.primaryTenant, l.lease]));
    expect(byTenant["Lindiwe Nkosi run"]).toMatchObject({ eftReference: "KC-0007", status: "active", dueDay: 25, endDate: null });
    expect(byTenant["Ayanda Khumalo run"]).toMatchObject({ status: "active", rentCents: 850_000, startDate: "2025-11-01", escalationBps: 800 });
    expect(byTenant["Ayanda Khumalo run"]!.eftReference).toMatch(/^TT-\d{4}$/);

    const kaya = (await listProperties(adminA, { q: "Kaya Court run" }))[0]!;
    const units = (await getProperty(adminA, kaya.property.id)).units;
    expect(Object.fromEntries(units.map((u) => [u.label, u.status]))).toEqual({ "Flat 1": "occupied", "Flat 2": "vacant" });

    const lindiwe = await getLease(adminA, byTenant["Lindiwe Nkosi run"]!.id);
    expect(lindiwe.tenants.map((t) => [t.fullName, t.isPrimary])).toEqual([
      ["Lindiwe Nkosi run", true],
      ["Sipho Nkosi run", false],
    ]);
    expect(lindiwe.events.map((e) => e.event.note)).toEqual(["Imported from spreadsheet"]);

    const jobs = await withAgency(adminA.ctx, (tx) => tx.select().from(schema.importJobs));
    expect(jobs.at(-1)).toMatchObject({ status: "completed", counts: { owners: 2, leases: 3 } });
  });

  it("refuses to import anything when a row has an error", async () => {
    const before = (await listTenants(adminA)).length;
    await expect(runImport(adminA, files("bad2", { units: "property_ref,unit_label\nP9,Flat 1" }), [])).rejects.toBeInstanceOf(
      ImportInvalidError,
    );
    expect((await listTenants(adminA)).length).toBe(before);
  });

  it("refuses absurd amounts at the check, before the database", async () => {
    const report = await checkImport(
      adminA,
      files("huge", {
        leases: `property_ref,unit_label,primary_tenant_ref,status,start_date,rent,due_day
P1,Main house,T1,active,2025-01-01,99999999,1`,
      }),
    );
    expect(report.errors.map((e) => e.message)).toContain("That is more than R10 million");
  });

  it("imports a double-submitted file once and rolls the other back completely", async () => {
    // Both pass the check (nothing is committed yet); the database's unique
    // EFT reference index then stops the second, and all its rows go with it.
    const before = (await listOwners(adminA)).length;
    const once = files("double", {
      leases: `property_ref,unit_label,primary_tenant_ref,eft_reference,status,start_date,rent,due_day
P1,Main house,T1,DBL-1,active,2025-01-01,9000,1`,
    });
    const results = await Promise.allSettled([runImport(adminA, once, ["a"]), runImport(adminA, once, ["b"])]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((await listOwners(adminA)).length).toBe(before + 2);
    const failed = await withAgency(adminA.ctx, (tx) => tx.select().from(schema.importJobs).where(eq(schema.importJobs.status, "failed")));
    expect(failed.length).toBeGreaterThan(0);
  });

  it("keeps each agency's import to itself", async () => {
    // Agency B can use the same reference: references are unique per agency
    await runImport(adminB, files("other"), []);
    expect((await listLeases(adminB, { q: "KC-0007" })).length).toBe(1);
    expect((await listOwners(adminB)).map((o) => o.name)).not.toContain("Thabo Mokoena run");
    expect((await listOwners(adminA)).map((o) => o.name)).not.toContain("Thabo Mokoena other");
  });
});
