import { createHash, randomBytes } from "node:crypto";
import { schema, type Tx, withAgency } from "@awdrent/db";
import { and, asc, desc, eq, inArray, isNull, lt, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { audit } from "./audit";
import { blindIndex, decrypt, encrypt, last4, normaliseIdentifier } from "./crypto";
import { type DocumentKind, storeUpload } from "./documents";
import { agencyOrigin } from "./hosts";
import { identityNumberProblem } from "./identity";
import { createDraftLeaseInTx } from "./leases";
import { leaseContact, send } from "./messages";
import { parseRandToCents } from "./money";
import { type Actor, assertUnitInScope, authorise, NotFoundError } from "./portfolio";
import { deleteObject } from "./storage";
import { tenantInsertValues } from "./tenants";

// Tenant onboarding (spec "Tenant onboarding", 8; D107–D113).
//
//   invite    an agent invites an applicant to a unit, with the rent and move-
//             in date they propose; the applicant is sent a personal link
//             (unguessable, valid 14 days by default, no account needed).
//   apply     on the agency's host the applicant consents (POPIA), fills in
//             their details and uploads a file for each checklist item; they
//             can come back until the link expires, then submit.
//   review    the agent accepts each file or rejects it with a reason, which
//             asks the applicant for a new one; then approves (creating the
//             tenant, with the files, and a draft lease) or declines.
//   tidy      links expire; one reminder after 3 days; the files and personal
//             details of applications that did not proceed are deleted after
//             the retention period (90 days by default).
//
// AWDRent does no credit checks or affordability scoring (spec).

export class ApplicationError extends Error {}

export type ApplicantType = "employed" | "self_employed" | "company";
export const APPLICANT_TYPE_LABEL: Record<ApplicantType, string> = { employed: "Employed", self_employed: "Self-employed", company: "Company" };
export interface ChecklistItem {
  key: string;
  label: string;
  required: boolean;
}

/** The spec's typical checklists (D107). */
export const DEFAULT_CHECKLISTS: Record<ApplicantType, ChecklistItem[]> = {
  employed: [
    { key: "id_document", label: "ID or passport", required: true },
    { key: "payslips", label: "Latest 3 payslips", required: true },
    { key: "bank_statements", label: "Last 3 months' bank statements", required: true },
    { key: "employer_letter", label: "Letter from your employer", required: false },
    { key: "proof_of_address", label: "Proof of current address", required: true },
  ],
  self_employed: [
    { key: "id_document", label: "ID or passport", required: true },
    { key: "proof_of_income", label: "Proof of income (e.g. accountant's letter or financial statements)", required: true },
    { key: "bank_statements", label: "Last 6 months' bank statements", required: true },
    { key: "proof_of_address", label: "Proof of current address", required: true },
  ],
  company: [
    { key: "company_registration", label: "Company registration documents", required: true },
    { key: "director_ids", label: "IDs of the directors", required: true },
    { key: "bank_statements", label: "Last 3 months' company bank statements", required: true },
    { key: "proof_of_address", label: "Proof of the company's address", required: false },
  ],
};

const ITEM_KIND: Record<string, DocumentKind> = {
  id_document: "id_document",
  director_ids: "id_document",
  payslips: "payslip",
  bank_statements: "bank_statement",
  employer_letter: "employer_letter",
  proof_of_address: "proof_of_address",
  proof_of_income: "proof_of_income",
  company_registration: "company_registration",
};

const TOKEN_FIELD = "applications.token";
const ID_FIELD = "applications.id_number";
const MAX_FILES_PER_ITEM = 5;
const REMINDER_AFTER_DAYS = 3;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const longDate = (d: Date) => new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Johannesburg" }).format(d);
const OPEN: ("invited" | "in_progress" | "submitted")[] = ["invited", "in_progress", "submitted"];

// ─── Checklists (agency settings) ──────────────────────────────────────

export const checklistSchema = z
  .array(z.object({ key: z.string().regex(/^[a-z0-9_]{2,40}$/), label: z.string().trim().min(2).max(120), required: z.boolean() }))
  .min(1)
  .max(15)
  .refine((items) => new Set(items.map((i) => i.key)).size === items.length, "Each item needs its own key");

async function checklistFor(tx: Tx, type: ApplicantType): Promise<ChecklistItem[]> {
  const [row] = await tx.select().from(schema.applicationChecklists).where(eq(schema.applicationChecklists.applicantType, type));
  return row?.items ?? DEFAULT_CHECKLISTS[type];
}

export async function listChecklists(actor: Actor) {
  authorise(actor, "settings.manage");
  return withAgency({ ...actor.ctx, readOnly: true }, async (tx) => {
    const rows = await tx.select().from(schema.applicationChecklists);
    return (Object.keys(DEFAULT_CHECKLISTS) as ApplicantType[]).map((type) => {
      const custom = rows.find((r) => r.applicantType === type);
      return { type, items: custom?.items ?? DEFAULT_CHECKLISTS[type], custom: !!custom };
    });
  });
}

export async function saveChecklist(actor: Actor, type: ApplicantType, input: ChecklistItem[]): Promise<void> {
  authorise(actor, "settings.manage");
  const items = checklistSchema.parse(input);
  await withAgency(actor.ctx, async (tx) => {
    await tx
      .insert(schema.applicationChecklists)
      .values({ applicantType: type, items })
      .onConflictDoUpdate({ target: [schema.applicationChecklists.agencyId, schema.applicationChecklists.applicantType], set: { items } });
    await audit(tx, { action: "application_checklist.saved", entity: "application_checklist", after: { type, items: items.length } });
  });
}

export async function resetChecklist(actor: Actor, type: ApplicantType): Promise<void> {
  authorise(actor, "settings.manage");
  await withAgency(actor.ctx, async (tx) => {
    await tx.delete(schema.applicationChecklists).where(eq(schema.applicationChecklists.applicantType, type));
    await audit(tx, { action: "application_checklist.reset", entity: "application_checklist", after: { type } });
  });
}

// ─── Staff: invite, review, decide ─────────────────────────────────────

export const inviteSchema = z
  .object({
    unitId: z.uuid("Choose the unit"),
    applicantType: z.enum(["employed", "self_employed", "company"]),
    fullName: z.string().trim().min(2, "Enter the applicant's name").max(160),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .refine((s) => s === "" || z.email().safeParse(s).success, "Enter a valid email address")
      .transform((s) => s || null),
    phone: z
      .string()
      .trim()
      .max(30)
      .transform((s) => s || null),
    proposedRent: z.string().transform((s, ctx) => {
      const cents = parseRandToCents(s);
      if (!cents) {
        ctx.addIssue({ code: "custom", message: "Enter the monthly rent" });
        return z.NEVER;
      }
      return cents;
    }),
    proposedStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the move-in date"),
  })
  .refine((v) => v.email || v.phone, { path: ["email"], message: "Enter an email address or mobile number to send the link to" });
export type InviteInput = z.infer<typeof inviteSchema>;

function newToken(agencyId: string) {
  const token = randomBytes(24).toString("base64url");
  return { token, tokenHash: sha256(token), tokenEnc: encrypt(token, { agencyId, field: TOKEN_FIELD }) };
}

const linkFor = async (tx: Tx, token: string) => {
  const [a] = await tx.select({ subdomain: schema.agencies.subdomain }).from(schema.agencies);
  return `${agencyOrigin(a!.subdomain)}/a/${token}`;
};
const tokenOf = (agencyId: string, app: { tokenEnc: string }) => decrypt(app.tokenEnc, { agencyId, field: TOKEN_FIELD });

async function unitName(tx: Tx, unitId: string) {
  const [u] = await tx
    .select({ label: schema.units.label, property: schema.properties.name })
    .from(schema.units)
    .innerJoin(schema.properties, eq(schema.properties.id, schema.units.propertyId))
    .where(eq(schema.units.id, unitId));
  return u ? `${u.label}, ${u.property}` : "";
}

/** Invites an applicant to a unit and sends them their link (application_invite). */
export async function inviteApplicant(actor: Actor, input: InviteInput): Promise<string> {
  authorise(actor, "applications.manage");
  return withAgency(actor.ctx, async (tx) => {
    await assertUnitInScope(tx, actor, input.unitId);
    const [agency] = await tx.select({ days: schema.agencies.applicationLinkDays }).from(schema.agencies);
    const { token, tokenHash, tokenEnc } = newToken(actor.ctx.agencyId);
    const expiresAt = new Date(Date.now() + agency!.days * 86_400_000);
    const [app] = await tx
      .insert(schema.applications)
      .values({
        unitId: input.unitId,
        applicantType: input.applicantType,
        checklist: await checklistFor(tx, input.applicantType),
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        tokenHash,
        tokenEnc,
        expiresAt,
        proposedRentCents: input.proposedRent,
        proposedStart: input.proposedStart,
      })
      .returning();
    await audit(tx, { action: "application.invited", entity: "application", entityId: app!.id, after: { unitId: input.unitId, fullName: input.fullName, type: input.applicantType } });
    await send(tx, {
      recipient: { kind: "applicant", applicationId: app!.id },
      templateKey: "application_invite",
      variables: { name: input.fullName.split(/\s+/)[0]!, unit: await unitName(tx, input.unitId), link: await linkFor(tx, token), date: longDate(expiresAt) },
    });
    return app!.id;
  });
}

function scopeToUnits(tx: Tx, actor: Actor): SQL | undefined {
  if (actor.role !== "agent") return undefined;
  return inArray(
    schema.applications.unitId,
    tx
      .select({ id: schema.units.id })
      .from(schema.units)
      .innerJoin(schema.agentPortfolios, eq(schema.agentPortfolios.propertyId, schema.units.propertyId))
      .where(eq(schema.agentPortfolios.userId, actor.userId ?? "00000000-0000-0000-0000-000000000000")),
  );
}

export async function listApplications(actor: Actor, opts: { open?: boolean } = {}) {
  authorise(actor, "applications.manage");
  return withAgency({ ...actor.ctx, readOnly: true }, async (tx) => {
    const rows = await tx
      .select({ app: schema.applications, unit: schema.units.label, property: schema.properties.name })
      .from(schema.applications)
      .innerJoin(schema.units, eq(schema.units.id, schema.applications.unitId))
      .innerJoin(schema.properties, eq(schema.properties.id, schema.units.propertyId))
      .where(and(scopeToUnits(tx, actor), opts.open ? inArray(schema.applications.status, OPEN) : undefined))
      .orderBy(desc(schema.applications.createdAt))
      .limit(200);
    return rows.map(({ app, unit, property }) => ({
      id: app.id,
      fullName: app.fullName,
      status: app.status,
      applicantType: app.applicantType,
      unit: `${unit}, ${property}`,
      createdAt: app.createdAt,
      expiresAt: app.expiresAt,
      submittedAt: app.submittedAt,
    }));
  });
}

async function loadForStaff(tx: Tx, actor: Actor, id: string, lock = false) {
  const q = tx.select().from(schema.applications).where(eq(schema.applications.id, id));
  const [app] = lock ? await q.for("update") : await q;
  if (!app) throw new NotFoundError("Application");
  await assertUnitInScope(tx, actor, app.unitId);
  return app;
}

async function filesOf(tx: Tx, applicationId: string) {
  return tx
    .select({ file: schema.applicationFiles, filename: schema.documents.filename, documentStatus: schema.documents.status })
    .from(schema.applicationFiles)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.applicationFiles.documentId))
    .where(and(eq(schema.applicationFiles.applicationId, applicationId), isNull(schema.documents.deletedAt)))
    .orderBy(asc(schema.applicationFiles.createdAt));
}

/** Per checklist item: the files, and whether it is done (an accepted file) or still needs something. */
function progress(checklist: ChecklistItem[], files: Awaited<ReturnType<typeof filesOf>>) {
  return checklist.map((item) => {
    const mine = files.filter((f) => f.file.itemKey === item.key);
    const accepted = mine.some((f) => f.file.status === "accepted");
    const pending = mine.some((f) => f.file.status === "pending");
    return { ...item, files: mine, accepted, pending, missing: !accepted && !pending };
  });
}

export async function getApplication(actor: Actor, id: string) {
  authorise(actor, "applications.manage");
  return withAgency({ ...actor.ctx, readOnly: true }, async (tx) => {
    const app = await loadForStaff(tx, actor, id);
    const items = progress(app.checklist, await filesOf(tx, app.id));
    const { tokenEnc: _t, tokenHash: _h, idNumberEnc: _e, idNumberBlindIndex: _b, ...safe } = app;
    return { app: safe, unit: await unitName(tx, app.unitId), items, canApprove: app.status === "submitted" && items.every((i) => !i.required || i.accepted) };
  });
}

/** Accept a file, or reject it with a reason (which asks the applicant for a new one, application_more_info). */
export async function reviewFile(actor: Actor, fileId: string, decision: { accept: true } | { accept: false; reason: string }): Promise<void> {
  authorise(actor, "applications.manage");
  await withAgency(actor.ctx, async (tx) => {
    const [file] = await tx.select().from(schema.applicationFiles).where(eq(schema.applicationFiles.id, fileId)).for("update");
    if (!file) throw new NotFoundError("File");
    const app = await loadForStaff(tx, actor, file.applicationId, true);
    if (!OPEN.includes(app.status as (typeof OPEN)[number])) throw new ApplicationError("This application is closed.");
    if (decision.accept) {
      // Only what could be opened and read can be accepted
      const [doc] = await tx.select({ status: schema.documents.status }).from(schema.documents).where(eq(schema.documents.id, file.documentId));
      if (doc?.status !== "clean") throw new ApplicationError("This file has not passed its virus check yet; it can be accepted once it opens.");
    }
    await tx
      .update(schema.applicationFiles)
      .set({ status: decision.accept ? "accepted" : "rejected", rejectReason: decision.accept ? null : decision.reason, reviewedAt: sql`now()`, reviewedBy: actor.userId })
      .where(eq(schema.applicationFiles.id, file.id));
    await audit(tx, { action: decision.accept ? "application.file_accepted" : "application.file_rejected", entity: "application", entityId: app.id, after: { itemKey: file.itemKey, reason: decision.accept ? null : decision.reason } });
    if (!decision.accept) {
      // Back with the applicant until they send a new file
      if (app.status === "submitted") await tx.update(schema.applications).set({ status: "in_progress" }).where(eq(schema.applications.id, app.id));
      const item = app.checklist.find((i) => i.key === file.itemKey);
      await send(tx, {
        recipient: { kind: "applicant", applicationId: app.id },
        templateKey: "application_more_info",
        variables: { name: app.fullName.split(/\s+/)[0]!, document: (item?.label ?? "document").toLowerCase(), reason: decision.reason, link: await linkFor(tx, tokenOf(actor.ctx.agencyId, app)) },
      });
    }
  });
}

/** Approves: creates the tenant (with the files) and a draft lease, and tells the applicant (D110). */
export async function approveApplication(actor: Actor, id: string): Promise<{ tenantId: string; leaseId: string }> {
  authorise(actor, "applications.manage");
  return withAgency(actor.ctx, async (tx) => {
    const app = await loadForStaff(tx, actor, id, true);
    if (app.status !== "submitted") throw new ApplicationError("Only a submitted application can be approved.");
    const items = progress(app.checklist, await filesOf(tx, app.id));
    const missing = items.filter((i) => i.required && !i.accepted);
    if (missing.length) throw new ApplicationError(`Accept a file for each required item first: ${missing.map((i) => i.label).join(", ")}.`);
    const idNumber = app.idNumberEnc ? decrypt(app.idNumberEnc, { agencyId: actor.ctx.agencyId, field: ID_FIELD }) : "";
    const [tenant] = await tx
      .insert(schema.tenants)
      .values(
        tenantInsertValues(actor.ctx.agencyId, {
          fullName: app.fullName,
          idKind: app.idKind ?? "sa_id",
          idNumber,
          email: app.email,
          phone: app.phone,
          employer: app.employer,
          emergencyContactName: null,
          emergencyContactPhone: null,
          consentGiven: !!app.consentAt,
          // The applicant gave contact details to be messaged about this rental
          emailOptIn: !!app.email,
          smsOptIn: !!app.phone,
          whatsappOptIn: false,
          notes: app.currentAddress ? `Address when applying: ${app.currentAddress}` : null,
        }),
      )
      .returning({ id: schema.tenants.id });
    await tx.update(schema.documents).set({ applicationId: null, tenantId: tenant!.id }).where(eq(schema.documents.applicationId, app.id));
    const lease = await createDraftLeaseInTx(tx, actor.ctx.agencyId, {
      unitId: app.unitId,
      primaryTenantId: tenant!.id,
      coTenantIds: [],
      startDate: app.proposedStart,
      billingStartsOn: null,
      endDate: null,
      rent: app.proposedRentCents,
      dueDay: 1,
      deposit: 0,
      escalationPercent: null,
      escalationDate: null,
      noticeDays: 30,
      notes: `From application by ${app.fullName}`,
    });
    await tx
      .update(schema.applications)
      .set({ status: "approved", decidedAt: sql`now()`, decidedBy: actor.userId, tenantId: tenant!.id, leaseId: lease.id })
      .where(eq(schema.applications.id, app.id));
    await audit(tx, { action: "application.approved", entity: "application", entityId: app.id, after: { tenantId: tenant!.id, leaseId: lease.id } });
    await send(tx, {
      recipient: { kind: "applicant", applicationId: app.id },
      templateKey: "application_outcome",
      variables: { name: app.fullName.split(/\s+/)[0]!, unit: await unitName(tx, app.unitId), outcome: "approved", agent_name: (await leaseContact(tx, lease.id)).agent_name },
    });
    return { tenantId: tenant!.id, leaseId: lease.id };
  });
}

/** Declines with a reason, kept internal; the applicant gets a courteous notice (D110). */
export async function declineApplication(actor: Actor, id: string, reason: string): Promise<void> {
  authorise(actor, "applications.manage");
  await withAgency(actor.ctx, async (tx) => {
    const app = await loadForStaff(tx, actor, id, true);
    if (!OPEN.includes(app.status as (typeof OPEN)[number])) throw new ApplicationError("This application is closed.");
    await tx.update(schema.applications).set({ status: "declined", decidedAt: sql`now()`, decidedBy: actor.userId, declineReason: reason }).where(eq(schema.applications.id, app.id));
    await audit(tx, { action: "application.declined", entity: "application", entityId: app.id, after: { reason } });
    const [agent] = await tx.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, actor.userId ?? "00000000-0000-0000-0000-000000000000"));
    const [agency] = await tx.select({ name: schema.agencies.name }).from(schema.agencies);
    await send(tx, {
      recipient: { kind: "applicant", applicationId: app.id },
      templateKey: "application_outcome",
      variables: { name: app.fullName.split(/\s+/)[0]!, unit: await unitName(tx, app.unitId), outcome: "declined", agent_name: agent?.name ?? agency!.name },
    });
  });
}

/** Stops the link working (e.g. sent to the wrong person). */
export async function revokeApplication(actor: Actor, id: string): Promise<void> {
  authorise(actor, "applications.manage");
  await withAgency(actor.ctx, async (tx) => {
    const app = await loadForStaff(tx, actor, id, true);
    if (!OPEN.includes(app.status as (typeof OPEN)[number])) throw new ApplicationError("This application is closed.");
    await tx.update(schema.applications).set({ status: "revoked", decidedAt: sql`now()`, decidedBy: actor.userId }).where(eq(schema.applications.id, app.id));
    await audit(tx, { action: "application.revoked", entity: "application", entityId: app.id });
  });
}

/** A new link (the old one stops working) with a fresh expiry, sent again. Also reopens an expired application. */
export async function resendApplication(actor: Actor, id: string): Promise<void> {
  authorise(actor, "applications.manage");
  await withAgency(actor.ctx, async (tx) => {
    const app = await loadForStaff(tx, actor, id, true);
    if (![...OPEN, "expired"].includes(app.status)) throw new ApplicationError("This application is closed.");
    if (app.purgedAt) throw new ApplicationError("This application's details have been deleted.");
    const [agency] = await tx.select({ days: schema.agencies.applicationLinkDays }).from(schema.agencies);
    const { token, tokenHash, tokenEnc } = newToken(actor.ctx.agencyId);
    const expiresAt = new Date(Date.now() + agency!.days * 86_400_000);
    await tx
      .update(schema.applications)
      .set({ tokenHash, tokenEnc, expiresAt, status: app.status === "expired" ? (app.consentAt ? "in_progress" : "invited") : app.status, decidedAt: null })
      .where(eq(schema.applications.id, app.id));
    await audit(tx, { action: "application.link_resent", entity: "application", entityId: app.id });
    await send(tx, {
      recipient: { kind: "applicant", applicationId: app.id },
      templateKey: "application_invite",
      variables: { name: app.fullName.split(/\s+/)[0]!, unit: await unitName(tx, app.unitId), link: await linkFor(tx, token), date: longDate(expiresAt) },
    });
  });
}

// ─── The applicant (public, on the agency's host) ──────────────────────
// The agency comes from the host; the token finds the application within it.

const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

async function byToken(tx: Tx, token: string, lock = false) {
  if (!TOKEN_RE.test(token)) return null;
  const q = tx.select().from(schema.applications).where(eq(schema.applications.tokenHash, sha256(token)));
  const [app] = lock ? await q.for("update") : await q;
  return app ?? null;
}

const usable = (app: typeof schema.applications.$inferSelect) =>
  (app.status === "invited" || app.status === "in_progress" || app.status === "submitted") && app.expiresAt.getTime() > Date.now() && !app.purgedAt;

export async function applicationForApplicant(agencyId: string, token: string) {
  return withAgency({ agencyId, readOnly: true }, async (tx) => {
    const app = await byToken(tx, token);
    if (!app) return null;
    const items = progress(app.checklist, await filesOf(tx, app.id));
    return {
      fullName: app.fullName,
      email: app.email,
      phone: app.phone,
      applicantType: app.applicantType,
      status: app.status,
      usable: usable(app),
      expiresAt: app.expiresAt,
      consented: !!app.consentAt,
      details: { idKind: app.idKind, idNumberLast4: app.idNumberLast4, employer: app.employer, currentAddress: app.currentAddress },
      unit: await unitName(tx, app.unitId),
      items: items.map((i) => ({
        key: i.key,
        label: i.label,
        required: i.required,
        accepted: i.accepted,
        missing: i.missing,
        files: i.files.map((f) => ({ id: f.file.id, filename: f.filename, status: f.file.status, rejectReason: f.file.rejectReason })),
      })),
      canSubmit: (app.status === "invited" || app.status === "in_progress") && !!app.consentAt && !!app.idNumberEnc && items.every((i) => !i.required || !i.missing),
    };
  });
}

async function forApplicant(tx: Tx, token: string) {
  const app = await byToken(tx, token, true);
  if (!app) throw new NotFoundError("Application");
  if (!usable(app)) throw new ApplicationError("This link can no longer be used. Please ask the agent for a new one.");
  return app;
}

/** POPIA consent, before anything else is collected (spec). */
export async function giveConsent(agencyId: string, token: string): Promise<void> {
  await withAgency({ agencyId }, async (tx) => {
    const app = await forApplicant(tx, token);
    if (app.consentAt) return;
    await tx.update(schema.applications).set({ consentAt: sql`now()`, status: app.status === "invited" ? "in_progress" : app.status }).where(eq(schema.applications.id, app.id));
    await audit(tx, { action: "application.consent_given", entity: "application", entityId: app.id });
  });
}

export const detailsSchema = z
  .object({
    fullName: z.string().trim().min(2).max(160),
    idKind: z.enum(["sa_id", "passport"]),
    // Empty keeps the number already given
    idNumber: z.string().trim().max(30).default(""),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .refine((s) => s === "" || z.email().safeParse(s).success, "Enter a valid email address")
      .transform((s) => s || null),
    phone: z
      .string()
      .trim()
      .max(30)
      .transform((s) => s || null),
    employer: z
      .string()
      .trim()
      .max(160)
      .transform((s) => s || null),
    currentAddress: z
      .string()
      .trim()
      .max(300)
      .transform((s) => s || null),
  })
  .superRefine((v, ctx) => {
    if (v.idNumber) {
      const problem = identityNumberProblem(v.idNumber, v.idKind === "sa_id" ? "sa_id" : "other");
      if (problem) ctx.addIssue({ code: "custom", path: ["idNumber"], message: problem });
    }
    if (!v.email && !v.phone) ctx.addIssue({ code: "custom", path: ["email"], message: "Give an email address or mobile number" });
  });

export async function saveDetails(agencyId: string, token: string, input: z.infer<typeof detailsSchema>): Promise<void> {
  await withAgency({ agencyId }, async (tx) => {
    const app = await forApplicant(tx, token);
    if (!app.consentAt) throw new ApplicationError("Please give your consent first.");
    if (app.status === "submitted") throw new ApplicationError("Your application has been submitted; contact the agent to change your details.");
    const id = input.idNumber ? normaliseIdentifier(input.idNumber) : null;
    const ctx = { agencyId, field: ID_FIELD };
    await tx
      .update(schema.applications)
      .set({
        fullName: input.fullName,
        idKind: input.idKind,
        email: input.email,
        phone: input.phone,
        employer: input.employer,
        currentAddress: input.currentAddress,
        ...(id ? { idNumberEnc: encrypt(id, ctx), idNumberLast4: last4(id), idNumberBlindIndex: blindIndex(id, ctx) } : {}),
      })
      .where(eq(schema.applications.id, app.id));
    await audit(tx, { action: "application.details_saved", entity: "application", entityId: app.id });
  });
}

/** A file for one checklist item, virus-scanned like any upload. */
export async function uploadApplicationFile(agencyId: string, token: string, input: { itemKey: string; filename: string; bytes: Uint8Array }): Promise<string> {
  const check = async (tx: Tx) => {
    const app = await forApplicant(tx, token);
    if (!app.consentAt) throw new ApplicationError("Please give your consent first.");
    if (!app.checklist.some((i) => i.key === input.itemKey)) throw new ApplicationError("Choose a checklist item.");
    const count = await tx
      .select({ id: schema.applicationFiles.id })
      .from(schema.applicationFiles)
      .where(and(eq(schema.applicationFiles.applicationId, app.id), eq(schema.applicationFiles.itemKey, input.itemKey)));
    if (count.length >= MAX_FILES_PER_ITEM) throw new ApplicationError(`At most ${MAX_FILES_PER_ITEM} files per item.`);
    return app;
  };
  // Not read-only: the check locks the application row
  const appId = await withAgency({ agencyId }, async (tx) => (await check(tx)).id);
  const documentId = await storeUpload(
    { agencyId },
    { subject: { type: "application", id: appId }, kind: ITEM_KIND[input.itemKey] ?? "other", filename: input.filename, bytes: input.bytes },
    async (tx) => void (await check(tx)),
  );
  await withAgency({ agencyId }, async (tx) => {
    await tx.insert(schema.applicationFiles).values({ applicationId: appId, itemKey: input.itemKey, documentId });
  });
  return documentId;
}

/** The applicant submits; the agents are told (application_submitted). */
export async function submitApplication(agencyId: string, token: string): Promise<void> {
  const view = await applicationForApplicant(agencyId, token);
  if (!view) throw new NotFoundError("Application");
  if (!view.canSubmit) throw new ApplicationError("Give your details and add a file for every required item first.");
  await withAgency({ agencyId }, async (tx) => {
    const app = await forApplicant(tx, token);
    await tx.update(schema.applications).set({ status: "submitted", submittedAt: sql`now()` }).where(eq(schema.applications.id, app.id));
    await audit(tx, { action: "application.submitted", entity: "application", entityId: app.id });
    const agents = await tx
      .select({ id: schema.users.id })
      .from(schema.units)
      .innerJoin(schema.agentPortfolios, eq(schema.agentPortfolios.propertyId, schema.units.propertyId))
      .innerJoin(schema.users, eq(schema.users.id, schema.agentPortfolios.userId))
      .where(and(eq(schema.units.id, app.unitId), eq(schema.users.active, true)));
    const recipients = agents.length ? agents.map((a) => a.id) : app.createdBy ? [app.createdBy] : [];
    const [agency] = await tx.select({ subdomain: schema.agencies.subdomain }).from(schema.agencies);
    for (const userId of new Set(recipients)) {
      await send(tx, {
        recipient: { kind: "staff", userId },
        templateKey: "application_submitted",
        variables: { applicant: app.fullName, unit: await unitName(tx, app.unitId), link: `${agencyOrigin(agency!.subdomain)}/applications/${app.id}` },
      });
    }
  });
}

// ─── Housekeeping (worker, daily) ──────────────────────────────────────

/** Expires old links, sends the 3-day reminder, and deletes what the retention period no longer allows (D111, D112). */
export async function applicationHousekeeping(agencyId: string, now = new Date()): Promise<{ expired: number; reminded: number; purged: number }> {
  const result = { expired: 0, reminded: 0, purged: 0 };
  const toPurge = await withAgency({ agencyId }, async (tx) => {
    const expired = await tx
      .update(schema.applications)
      .set({ status: "expired" })
      .where(and(inArray(schema.applications.status, ["invited", "in_progress"]), lt(schema.applications.expiresAt, now)))
      .returning({ id: schema.applications.id });
    result.expired = expired.length;

    const reminderBefore = new Date(now.getTime() - REMINDER_AFTER_DAYS * 86_400_000);
    const due = await tx
      .select()
      .from(schema.applications)
      .where(and(inArray(schema.applications.status, ["invited", "in_progress"]), lt(schema.applications.createdAt, reminderBefore), isNull(schema.applications.remindedAt)));
    for (const app of due) {
      const items = progress(app.checklist, await filesOf(tx, app.id));
      const missing = items.filter((i) => i.required && i.missing).length;
      await tx.update(schema.applications).set({ remindedAt: now }).where(eq(schema.applications.id, app.id));
      await send(tx, {
        recipient: { kind: "applicant", applicationId: app.id },
        templateKey: "application_reminder",
        variables: { name: app.fullName.split(/\s+/)[0]!, unit: await unitName(tx, app.unitId), count: String(Math.max(missing, 1)), link: await linkFor(tx, tokenOf(agencyId, app)) },
      });
      result.reminded++;
    }

    const [agency] = await tx.select({ days: schema.agencies.applicationRetentionDays }).from(schema.agencies);
    const cutoff = new Date(now.getTime() - agency!.days * 86_400_000);
    const old = await tx
      .select({ id: schema.applications.id })
      .from(schema.applications)
      .where(
        and(
          inArray(schema.applications.status, ["declined", "revoked", "expired"]),
          isNull(schema.applications.purgedAt),
          sql`coalesce(${schema.applications.decidedAt}, ${schema.applications.expiresAt}) < ${cutoff}`,
        ),
      );
    return old.map((o) => o.id);
  });

  for (const id of toPurge) {
    const docs = await withAgency({ agencyId }, async (tx) => {
      const rows = await tx
        .update(schema.documents)
        .set({ deletedAt: sql`now()` })
        .where(and(eq(schema.documents.applicationId, id), isNull(schema.documents.deletedAt)))
        .returning({ fileKey: schema.documents.fileKey });
      await tx
        .update(schema.applications)
        .set({
          purgedAt: sql`now()`,
          email: null,
          phone: null,
          idNumberEnc: null,
          idNumberLast4: null,
          idNumberBlindIndex: null,
          employer: null,
          currentAddress: null,
          tokenHash: sha256(randomBytes(24).toString("base64url")),
          tokenEnc: "",
        })
        .where(eq(schema.applications.id, id));
      await audit(tx, { action: "application.purged", entity: "application", entityId: id, after: { files: rows.length } });
      return rows;
    });
    for (const d of docs) await deleteObject(d.fileKey).catch(() => undefined);
    result.purged++;
  }
  return result;
}
