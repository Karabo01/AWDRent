import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@awdrent/config";
import { closeDb, schema, withAgency } from "@awdrent/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgencyWithAdmin } from "../../db/test/fixtures";
import {
  ApplicationError,
  applicationForApplicant,
  applicationHousekeeping,
  approveApplication,
  declineApplication,
  getApplication,
  giveConsent,
  inviteApplicant,
  reviewFile,
  saveDetails,
  submitApplication,
  uploadApplicationFile,
} from "../src/onboarding";
import { createOwner } from "../src/owners";
import { type Actor, NotFoundError } from "../src/portfolio";
import { createProperty, createUnit, setPropertyAgents } from "../src/properties";
import { inviteStaff } from "../src/staff";

const PDF = new Uint8Array(Buffer.from("%PDF-1.4\n%%EOF\n"));
let a: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let b: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let adminA: Actor;
let adminB: Actor;
let agentA: Actor;
let otherAgentA: Actor;
let unitId: string;
let n = 0;

const invite = (actor: Actor, name = "Karabo Morena") =>
  inviteApplicant(actor, {
    unitId,
    applicantType: "employed",
    fullName: name,
    email: `applicant${++n}@example.test`,
    phone: "0825550199",
    proposedRent: 950_000,
    proposedStart: "2026-12-01",
  });

/** The applicant's link token, from the newest invitation message. */
async function tokenOf(applicationId: string, key = "application_invite") {
  const rows = await withAgency({ agencyId: a.agency.id }, (tx) =>
    tx.select().from(schema.messages).where(and(eq(schema.messages.recipientId, applicationId), eq(schema.messages.templateKey, key))),
  );
  const link = rows.sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())[0]!.payload.link!;
  return link.split("/a/")[1]!;
}

async function completeAsApplicant(token: string) {
  await giveConsent(a.agency.id, token);
  await saveDetails(a.agency.id, token, {
    fullName: "Karabo Morena",
    idKind: "sa_id",
    idNumber: "9001015009086",
    email: "karabo@example.test",
    phone: "0825550199",
    employer: "Acme (Pty) Ltd",
    currentAddress: "3 Elm Road, Pretoria",
  });
  for (const key of ["id_document", "payslips", "bank_statements", "proof_of_address"]) {
    await uploadApplicationFile(a.agency.id, token, { itemKey: key, filename: `${key}.pdf`, bytes: PDF });
  }
}

beforeAll(async () => {
  await new S3Client({
    endpoint: env().S3_ENDPOINT,
    region: env().S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env().S3_ACCESS_KEY_ID, secretAccessKey: env().S3_SECRET_ACCESS_KEY },
  })
    .send(new CreateBucketCommand({ Bucket: env().S3_BUCKET }))
    .catch(() => undefined);
  a = await createAgencyWithAdmin("OnbA");
  b = await createAgencyWithAdmin("OnbB");
  adminA = { ctx: { agencyId: a.agency.id, userId: a.admin.id }, role: "admin", userId: a.admin.id };
  adminB = { ctx: { agencyId: b.agency.id, userId: b.admin.id }, role: "admin", userId: b.admin.id };
  const agentId = await inviteStaff(adminA.ctx, { name: "Lesedi Mapena", email: `oagent-${Date.now()}@a.test`, role: "agent", phone: "0825550123" });
  agentA = { ctx: { agencyId: a.agency.id, userId: agentId }, role: "agent", userId: agentId };
  const otherId = await inviteStaff(adminA.ctx, { name: "Other Agent", email: `oother-${Date.now()}@a.test`, role: "agent", phone: null });
  otherAgentA = { ctx: { agencyId: a.agency.id, userId: otherId }, role: "agent", userId: otherId };
  const owner = await createOwner(adminA, {
    kind: "individual",
    name: "Onb Owner",
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
    name: "Lion Sands",
    type: "house",
    addressLine1: "70 Lion Sands",
    addressLine2: null,
    suburb: "Mooikloof Ridge",
    city: "Pretoria",
    province: null,
    postalCode: null,
    notes: null,
  });
  await setPropertyAgents(adminA, property, [agentA.userId!]);
  unitId = await createUnit(adminA, property, { label: "Main", bedrooms: 3, bathrooms: 2, status: "vacant", notes: null });
});
afterAll(() => closeDb());

describe("tenant onboarding", () => {
  it("goes from invitation to an approved tenant with a draft lease and the documents", async () => {
    const id = await invite(agentA);
    const token = await tokenOf(id);
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    await expect(uploadApplicationFile(a.agency.id, token, { itemKey: "payslips", filename: "p.pdf", bytes: PDF })).rejects.toThrow(/consent/);
    await completeAsApplicant(token);
    expect(await applicationForApplicant(a.agency.id, token)).toMatchObject({ canSubmit: true, status: "in_progress" });
    await submitApplication(a.agency.id, token);
    const submitted = await withAgency(adminA.ctx, (tx) =>
      tx.select().from(schema.messages).where(and(eq(schema.messages.templateKey, "application_submitted"), eq(schema.messages.recipientId, agentA.userId!))),
    );
    expect(submitted).toHaveLength(1);

    // The agent asks for a better payslip
    let view = await getApplication(agentA, id);
    expect(view.canApprove).toBe(false);
    const payslip = view.items.find((i) => i.key === "payslips")!.files[0]!;
    await reviewFile(agentA, payslip.file.id, { accept: false, reason: "the March payslip is missing" });
    expect((await applicationForApplicant(a.agency.id, token))!.status).toBe("in_progress");
    // The request repeats the applicant's link
    expect(await tokenOf(id, "application_more_info")).toBe(token);
    await uploadApplicationFile(a.agency.id, token, { itemKey: "payslips", filename: "march.pdf", bytes: PDF });
    await submitApplication(a.agency.id, token);

    view = await getApplication(agentA, id);
    const pending = view.items.flatMap((i) => i.files).filter((f) => f.file.status === "pending");
    // Not before the virus check (the worker's job; done by hand here)
    await expect(reviewFile(agentA, pending[0]!.file.id, { accept: true })).rejects.toThrow(/virus check/);
    await withAgency(adminA.ctx, (tx) => tx.update(schema.documents).set({ status: "clean" }).where(eq(schema.documents.applicationId, id)));
    for (const f of pending) await reviewFile(agentA, f.file.id, { accept: true });
    view = await getApplication(agentA, id);
    expect(view.canApprove).toBe(true);

    const { tenantId, leaseId } = await approveApplication(agentA, id);
    const [tenant] = await withAgency(adminA.ctx, (tx) => tx.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)));
    expect(tenant).toMatchObject({ fullName: "Karabo Morena", idNumberLast4: "9086", email: "karabo@example.test", employer: "Acme (Pty) Ltd" });
    expect(tenant!.consentAt).not.toBeNull();
    const [lease] = await withAgency(adminA.ctx, (tx) => tx.select().from(schema.leases).where(eq(schema.leases.id, leaseId)));
    expect(lease).toMatchObject({ status: "draft", rentCents: 950_000, startDate: "2026-12-01", unitId });
    const docs = await withAgency(adminA.ctx, (tx) => tx.select().from(schema.documents).where(eq(schema.documents.tenantId, tenantId)));
    expect(docs.map((d) => d.filename).sort()).toEqual(["bank_statements.pdf", "id_document.pdf", "march.pdf", "payslips.pdf", "proof_of_address.pdf"]);
    // The link no longer works, and the outcome was sent
    expect((await applicationForApplicant(a.agency.id, token))!.usable).toBe(false);
    const [outcome] = await withAgency(adminA.ctx, (tx) =>
      tx.select().from(schema.messages).where(and(eq(schema.messages.templateKey, "application_outcome"), eq(schema.messages.recipientId, id), eq(schema.messages.channel, "email"))),
    );
    expect(outcome!.body).toContain("has been approved");
  });

  it("will not approve until every required item is accepted, and declines courteously", async () => {
    const id = await invite(adminA);
    const token = await tokenOf(id);
    await completeAsApplicant(token);
    await submitApplication(a.agency.id, token);
    await expect(approveApplication(adminA, id)).rejects.toBeInstanceOf(ApplicationError);
    await declineApplication(adminA, id, "Income too low for the rent");
    const [outcome] = await withAgency(adminA.ctx, (tx) =>
      tx.select().from(schema.messages).where(and(eq(schema.messages.templateKey, "application_outcome"), eq(schema.messages.recipientId, id), eq(schema.messages.channel, "email"))),
    );
    expect(outcome!.body).toContain("has been declined");
    // The internal reason is not sent
    expect(outcome!.body).not.toContain("Income too low");
  });

  it("reminds once, expires the link, and deletes what it may not keep", async () => {
    const id = await invite(adminA, "Slow Applicant");
    const day = 86_400_000;
    expect((await applicationHousekeeping(a.agency.id, new Date(Date.now() + 4 * day))).reminded).toBeGreaterThanOrEqual(1);
    const again = await applicationHousekeeping(a.agency.id, new Date(Date.now() + 5 * day));
    const [reminders] = await withAgency(adminA.ctx, (tx) =>
      tx.select().from(schema.messages).where(and(eq(schema.messages.templateKey, "application_reminder"), eq(schema.messages.recipientId, id))),
    );
    expect(reminders).toBeDefined();
    expect(again.reminded).toBe(0);

    const token = await tokenOf(id);
    await giveConsent(a.agency.id, token);
    await uploadApplicationFile(a.agency.id, token, { itemKey: "id_document", filename: "id.pdf", bytes: PDF });
    await applicationHousekeeping(a.agency.id, new Date(Date.now() + 15 * day));
    expect((await applicationForApplicant(a.agency.id, token))).toMatchObject({ status: "expired", usable: false });

    await applicationHousekeeping(a.agency.id, new Date(Date.now() + 120 * day));
    const [app] = await withAgency(adminA.ctx, (tx) => tx.select().from(schema.applications).where(eq(schema.applications.id, id)));
    expect(app).toMatchObject({ email: null, phone: null, idNumberEnc: null });
    expect(app!.purgedAt).not.toBeNull();
    const docs = await withAgency(adminA.ctx, (tx) => tx.select().from(schema.documents).where(eq(schema.documents.applicationId, id)));
    expect(docs.every((d) => d.deletedAt !== null)).toBe(true);
  });

  it("keeps applications within the agent's portfolio and the agency", async () => {
    const id = await invite(agentA, "Private Person");
    const token = await tokenOf(id);
    await expect(getApplication(otherAgentA, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getApplication(adminB, id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await applicationForApplicant(b.agency.id, token)).toBeNull();
    await expect(giveConsent(b.agency.id, token)).rejects.toBeInstanceOf(NotFoundError);
  });
});
