import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "@awdrent/config";
import { schema, type Tx, withAgency } from "@awdrent/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { trustAccountNumber } from "./agency-settings";
import { audit } from "./audit";
import { detectFileType } from "./file-types";
import { agencyOrigin } from "./hosts";
import { bpsToPercentString } from "./money";
import { countUsage, emailBrand, type Recipient, send, unitName } from "./messages";
import { defaultProviders, type Providers } from "./messaging/providers";
import { renderEmail, toGsm, toMsisdn } from "./messaging/render";
import type { AppliedSignature, Certificate, EnvelopeContent, LeaseContent, LetterContent, SignatureBlock } from "./pdf/signing";
import { renderEnvelopeDocument } from "./pdf/signing";
import { type Actor, assertLeaseInScope, authorise, NotFoundError } from "./portfolio";
import { loadBrand, pdfDate, pdfMoney } from "./receipts";
import { LEASE_FIELDS, type Section, STANDARD_LEASE } from "./signing/standard-lease";
import { putGenerated, readObject } from "./storage";
import { unknownVariables } from "./messaging/render";

// Lease documents and built-in e-signing (D47–D49, D51, D54; D81–D86).
//
//   prepare   staff choose the document and signers; the content is frozen
//             into an envelope, rendered to the PDF every signer will see,
//             fingerprinted (SHA-256) and filed with the lease.
//   invite    signers in the first position get a personal link by email
//             and SMS; later positions are invited only when everyone before
//             them has signed (tenants, then owner, then agent).
//   sign      on the agency's own host, the signer confirms a one-time code,
//             types their name and draws their signature.
//   complete  the signed PDF is built from the same content with the
//             signatures and a certificate page, filed with the lease and
//             sent to every signer.

export type GeneratedKind = "lease_agreement" | "confirmation_letter";
export const KIND_LABEL: Record<GeneratedKind, string> = { lease_agreement: "lease agreement", confirmation_letter: "lease confirmation letter" };

export class SigningError extends Error {}

const LINK_DAYS = 14;
const CODE_MINUTES = 10;
const CODE_TRIES = 5;
// After the code is confirmed, the signer has this long to sign
const VERIFIED_MINUTES = 30;
const MAX_SIGNATURE_BYTES = 300_000;

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
// en-ZA puts no-break spaces in dates, which the PDF fonts cannot draw
const NO_BREAK_SPACES = new RegExp(`[${String.fromCharCode(0xa0)}${String.fromCharCode(0x202f)}]`, "g");
const longDate = (d: Date) => new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Johannesburg" }).format(d);
const dateTime = (d: Date) =>
  new Intl.DateTimeFormat("en-ZA", { dateStyle: "long", timeStyle: "medium", timeZone: "Africa/Johannesburg" }).format(d).replace(NO_BREAK_SPACES, " ");
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

// ─── The agency's lease template (D51, D82) ─────────────────────────────

export const sectionsSchema = z
  .array(z.object({ heading: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(6000) }))
  .min(1)
  .max(60);

export async function leaseTemplate(actor: Actor): Promise<{ sections: Section[]; custom: boolean }> {
  authorise(actor, "settings.manage");
  const [row] = await withAgency({ ...actor.ctx, readOnly: true }, (tx) =>
    tx.select().from(schema.documentTemplates).where(eq(schema.documentTemplates.kind, "lease_agreement")),
  );
  return row ? { sections: row.sections, custom: true } : { sections: STANDARD_LEASE, custom: false };
}

/** Problems with an edited template: unknown merge fields, by clause. */
export function checkTemplate(sections: Section[]): string[] {
  const allowed = Object.keys(LEASE_FIELDS);
  return sections.flatMap((s, i) => {
    const unknown = unknownVariables(`${s.heading} ${s.body}`, allowed);
    return unknown.length ? [`Clause ${i + 1} (${s.heading}) uses ${unknown.map((u) => `{${u}}`).join(", ")}, which is not a field.`] : [];
  });
}

export async function saveLeaseTemplate(actor: Actor, input: Section[]): Promise<void> {
  authorise(actor, "settings.manage");
  const sections = sectionsSchema.parse(input);
  const problems = checkTemplate(sections);
  if (problems.length) throw new SigningError(problems.join(" "));
  await withAgency(actor.ctx, async (tx) => {
    await tx
      .insert(schema.documentTemplates)
      .values({ kind: "lease_agreement", sections })
      .onConflictDoUpdate({ target: [schema.documentTemplates.agencyId, schema.documentTemplates.kind], set: { sections } });
    await audit(tx, { action: "document_template.saved", entity: "document_template", after: { kind: "lease_agreement", clauses: sections.length } });
  });
}

export async function resetLeaseTemplate(actor: Actor): Promise<void> {
  authorise(actor, "settings.manage");
  await withAgency(actor.ctx, async (tx) => {
    const deleted = await tx.delete(schema.documentTemplates).where(eq(schema.documentTemplates.kind, "lease_agreement")).returning();
    if (deleted.length) await audit(tx, { action: "document_template.reset", entity: "document_template", after: { kind: "lease_agreement" } });
  });
}

// ─── Preparing a document ──────────────────────────────────────────────

export const prepareSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("lease_agreement"), landlordSignatory: z.enum(["owner", "agent"]), agentUserId: z.uuid() }),
  z.object({ kind: z.literal("confirmation_letter"), agentUserId: z.uuid(), representativeUserId: z.uuid() }),
]);
export type PrepareInput = z.infer<typeof prepareSchema>;

interface SignerDraft {
  position: number;
  role: "tenant" | "owner" | "agent" | "agency_representative";
  partyId: string;
  name: string;
  capacity: string;
  email: string | null;
  phone: string | null;
}

async function leaseFacts(tx: Tx, leaseId: string) {
  const [row] = await tx
    .select({ lease: schema.leases, unit: schema.units, property: schema.properties, owner: schema.owners, agency: schema.agencies })
    .from(schema.leases)
    .innerJoin(schema.units, eq(schema.units.id, schema.leases.unitId))
    .innerJoin(schema.properties, eq(schema.properties.id, schema.units.propertyId))
    .innerJoin(schema.owners, eq(schema.owners.id, schema.properties.ownerId))
    .innerJoin(schema.agencies, eq(schema.agencies.id, schema.leases.agencyId))
    .where(eq(schema.leases.id, leaseId));
  if (!row) throw new NotFoundError("Lease");
  const tenants = await tx
    .select({ tenant: schema.tenants, isPrimary: schema.leaseTenants.isPrimary })
    .from(schema.leaseTenants)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.leaseTenants.tenantId))
    .where(eq(schema.leaseTenants.leaseId, leaseId))
    .orderBy(desc(schema.leaseTenants.isPrimary), asc(schema.tenants.fullName));
  return { ...row, tenants: tenants.map((t) => t.tenant) };
}

async function staffMember(tx: Tx, userId: string, roles: ("admin" | "agent" | "accounts")[], what: string) {
  const [u] = await tx.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!u || !u.active || !roles.includes(u.role)) throw new SigningError(`Choose an active ${what}.`);
  return u;
}

const joinNames = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** The merge-field values for a lease (D83): ID numbers are shown masked, as everywhere else. */
export async function leaseFieldValues(tx: Tx, agencyId: string, leaseId: string, signatory: { kind: "owner" | "agent"; agentName: string }) {
  const f = await leaseFacts(tx, leaseId);
  const { lease, property: p, owner, agency: a } = f;
  const idText = (t: (typeof f.tenants)[number]) =>
    t.idNumberLast4 ? `${t.fullName} (${t.idKind === "passport" ? "passport" : "identity"} number ending ${t.idNumberLast4})` : t.fullName;
  const notSet = "(not set)";
  const account = a.trustAccountNoEnc ? await trustAccountNumber({ agencyId, readOnly: true }) : null;
  const address = [`${f.unit.label}, ${p.name}`, p.addressLine1 !== p.name ? p.addressLine1 : null, p.addressLine2, p.suburb, p.city, p.postalCode]
    .filter(Boolean)
    .join(", ");
  const escalation =
    lease.escalationBps !== null && lease.escalationDate
      ? `The rent increases by ${bpsToPercentString(lease.escalationBps)}% with effect from ${pdfDate(lease.escalationDate)}. Any further increase on renewal will be agreed in writing.`
      : "The rent is fixed for the period of this lease. Any increase on renewal will be agreed in writing.";
  return {
    facts: f,
    values: {
      agency_name: a.name,
      agency_legal_name: a.legalName ?? a.name,
      agency_registration_no: a.registrationNo ?? notSet,
      agency_ffc: a.ffcNumber ?? notSet,
      agency_address: a.physicalAddress?.replace(/\s*\n\s*/g, ", ") ?? notSet,
      landlord_name: owner.name,
      landlord_address: owner.postalAddress?.replace(/\s*\n\s*/g, ", ") ?? "the address held by the Agent",
      landlord_signatory: signatory.kind === "owner" ? "the Landlord personally" : `${signatory.agentName} of ${a.name}, as the Landlord's agent under mandate`,
      tenant_names: joinNames(f.tenants.map((t) => t.fullName)),
      tenant_details: joinNames(f.tenants.map(idText)),
      property_address: address,
      start_date: pdfDate(lease.startDate),
      lease_term: lease.endDate ? `a fixed term ending on ${pdfDate(lease.endDate)}` : "an indefinite period, from month to month",
      rent: pdfMoney(lease.rentCents),
      due_day: ordinal(lease.dueDay),
      escalation,
      deposit: pdfMoney(lease.depositCents),
      notice_days: String(lease.noticeDays),
      eft_reference: lease.eftReference,
      trust_bank: a.trustBankName ?? notSet,
      trust_account_holder: a.trustAccountHolder ?? a.legalName ?? a.name,
      trust_account_number: account ?? notSet,
      trust_branch_code: a.trustBranchCode ?? notSet,
    } satisfies Record<keyof typeof LEASE_FIELDS, string>,
  };
}

const fill = (text: string, values: Record<string, string>) => text.replace(/\{([a-z_]+)\}/g, (m, k: string) => values[k] ?? m);

async function build(tx: Tx, agencyId: string, leaseId: string, input: PrepareInput): Promise<{ content: EnvelopeContent; signers: SignerDraft[]; missing: string[] }> {
  const agent = await staffMember(tx, input.agentUserId, ["agent", "admin"], "agent");
  const agentPhone = toMsisdn(agent.phone);
  const preparedOn = longDate(new Date());
  if (input.kind === "confirmation_letter") {
    const rep = await staffMember(tx, input.representativeUserId, ["admin"], "admin as the authorised representative");
    if (rep.id === agent.id) throw new SigningError("The authorised representative must be someone other than the agent.");
    const f = await leaseFacts(tx, leaseId);
    const p = f.property;
    const content: LetterContent = {
      kind: "confirmation_letter",
      title: `Lease confirmation letter ${f.lease.eftReference}`,
      preparedOn,
      propertyAddress: [`${f.unit.label}, ${p.name}`, p.addressLine1 !== p.name ? p.addressLine1 : null, p.suburb, p.city].filter(Boolean).join(", "),
      agentName: agent.name,
      agencyName: f.agency.legalName ?? f.agency.name,
      startDate: pdfDate(f.lease.startDate),
      endDate: f.lease.endDate ? pdfDate(f.lease.endDate) : null,
      tenants: f.tenants.map((t) => t.fullName),
      blocks: [
        { name: agent.name, capacity: "Agent" },
        { name: rep.name, capacity: `Authorised Representative, ${f.agency.legalName ?? f.agency.name}` },
      ],
    };
    return {
      content,
      signers: [
        { position: 1, role: "agent", partyId: agent.id, name: agent.name, capacity: "Agent", email: agent.email, phone: agentPhone },
        { position: 2, role: "agency_representative", partyId: rep.id, name: rep.name, capacity: content.blocks[1]!.capacity, email: rep.email, phone: toMsisdn(rep.phone) },
      ],
      missing: [],
    };
  }

  const { facts: f, values } = await leaseFieldValues(tx, agencyId, leaseId, { kind: input.landlordSignatory, agentName: agent.name });
  const [custom] = await tx.select().from(schema.documentTemplates).where(eq(schema.documentTemplates.kind, "lease_agreement"));
  const sections = (custom?.sections ?? STANDARD_LEASE).map((s) => ({ heading: fill(s.heading, values), body: fill(s.body, values) }));
  const signers: SignerDraft[] = f.tenants.map((t) => ({
    position: 1,
    role: "tenant",
    partyId: t.id,
    name: t.fullName,
    capacity: "Tenant",
    email: t.email,
    phone: toMsisdn(t.phone),
  }));
  if (input.landlordSignatory === "owner") {
    signers.push({ position: 2, role: "owner", partyId: f.owner.id, name: f.owner.name, capacity: "Landlord", email: f.owner.email, phone: toMsisdn(f.owner.phone) });
  }
  const agentCapacity =
    input.landlordSignatory === "agent" ? `Agent, for and on behalf of the Landlord (${f.owner.name}) under mandate` : `Agent, ${f.agency.legalName ?? f.agency.name}`;
  signers.push({ position: 3, role: "agent", partyId: agent.id, name: agent.name, capacity: agentCapacity, email: agent.email, phone: agentPhone });
  const blocks: SignatureBlock[] = signers.map((s) => ({ name: s.name, capacity: s.capacity }));
  const content: LeaseContent = { kind: "lease_agreement", title: `Lease agreement ${f.lease.eftReference}`, preparedOn, sections, blocks };
  const missing = Object.entries(values)
    .filter(([, v]) => v === "(not set)")
    .map(([k]) => LEASE_FIELDS[k]!);
  return { content, signers, missing };
}

/** A watermarked draft for staff to check before sending, with any agency details still missing. */
export async function previewDocument(actor: Actor, leaseId: string, input: PrepareInput): Promise<{ bytes: Uint8Array; missing: string[] }> {
  authorise(actor, "documents.prepare");
  const built = await withAgency({ ...actor.ctx, readOnly: true }, async (tx) => {
    await assertLeaseInScope(tx, actor, leaseId);
    return build(tx, actor.ctx.agencyId, leaseId, input);
  });
  const pdf = await renderEnvelopeDocument(await loadBrand(actor.ctx.agencyId), built.content, { draft: true });
  return { bytes: new Uint8Array(pdf), missing: built.missing };
}

async function fileDocument(tx: Tx, leaseId: string, kind: GeneratedKind, filename: string, key: string, bytes: Uint8Array) {
  const [doc] = await tx
    .insert(schema.documents)
    .values({
      leaseId,
      kind,
      filename,
      contentType: "application/pdf",
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      fileKey: key,
      status: "clean",
      scanResult: "generated",
      scannedAt: sql`now()`,
    })
    .returning({ id: schema.documents.id });
  return doc!.id;
}

const recipientFor = (s: { role: string; partyId: string }): Recipient =>
  s.role === "tenant" ? { kind: "tenant", tenantId: s.partyId } : s.role === "owner" ? { kind: "owner", ownerId: s.partyId } : { kind: "staff", userId: s.partyId };

/** Gives a signer a fresh personal link and sends it to them (D84). */
async function invite(tx: Tx, envelope: typeof schema.signingEnvelopes.$inferSelect, signer: typeof schema.signers.$inferSelect): Promise<void> {
  const token = randomBytes(24).toString("base64url");
  await tx
    .update(schema.signers)
    .set({
      status: "invited",
      tokenHash: sha256(token),
      tokenExpiresAt: sql`now() + interval '${sql.raw(String(LINK_DAYS))} days'`,
      invitedAt: sql`now()`,
      codeHash: null,
      codeExpiresAt: null,
      codeAttempts: 0,
      codeVerifiedAt: null,
    })
    .where(eq(schema.signers.id, signer.id));
  const [agency] = await tx.select({ subdomain: schema.agencies.subdomain }).from(schema.agencies);
  await send(tx, {
    recipient: recipientFor(signer),
    templateKey: "signing_request",
    leaseId: envelope.leaseId,
    transactional: true,
    variables: {
      name: signer.name.trim().split(/\s+/)[0]!,
      document: KIND_LABEL[envelope.kind],
      unit: await unitName(tx, envelope.leaseId),
      link: `${agencyOrigin(agency!.subdomain)}/s/${token}`,
    },
  });
}

/** Prepares the document, files the version for signing and invites the first signers. */
export async function sendForSigning(actor: Actor, leaseId: string, input: PrepareInput): Promise<string> {
  authorise(actor, "documents.prepare");
  const built = await withAgency({ ...actor.ctx, readOnly: true }, async (tx) => {
    await assertLeaseInScope(tx, actor, leaseId);
    const [lease] = await tx.select({ status: schema.leases.status }).from(schema.leases).where(eq(schema.leases.id, leaseId));
    if (input.kind === "confirmation_letter" && !["active", "notice_given"].includes(lease!.status)) {
      throw new SigningError("A confirmation letter is for a lease that has started; activate the lease first.");
    }
    if (input.kind === "lease_agreement" && !["draft", "active", "notice_given"].includes(lease!.status)) {
      throw new SigningError("This lease has ended.");
    }
    return build(tx, actor.ctx.agencyId, leaseId, input);
  });
  const unreachable = built.signers.filter((s) => !s.email && !s.phone && s.role !== "agent" && s.role !== "agency_representative");
  if (unreachable.length) throw new SigningError(`Add an email address or mobile number for ${joinNames(unreachable.map((s) => s.name))} first.`);
  const noEmail = built.signers.filter((s) => !s.email && (s.role === "owner" || s.role === "agent" || s.role === "agency_representative"));
  if (noEmail.length) throw new SigningError(`Add an email address for ${joinNames(noEmail.map((s) => s.name))} first.`);

  const pdf = new Uint8Array(await renderEnvelopeDocument(await loadBrand(actor.ctx.agencyId), built.content));
  const key = await putGenerated(actor.ctx.agencyId, pdf, "application/pdf", "pdf");
  return withAgency(actor.ctx, async (tx) => {
    await assertLeaseInScope(tx, actor, leaseId);
    const [open] = await tx
      .select({ id: schema.signingEnvelopes.id })
      .from(schema.signingEnvelopes)
      .where(and(eq(schema.signingEnvelopes.leaseId, leaseId), eq(schema.signingEnvelopes.kind, input.kind), eq(schema.signingEnvelopes.status, "out_for_signing")))
      .for("update");
    if (open) throw new SigningError(`A ${KIND_LABEL[input.kind]} is already out for signing; cancel it first.`);
    const label = input.kind === "lease_agreement" ? "Lease agreement" : "Lease confirmation letter";
    const lease = (await tx.select({ ref: schema.leases.eftReference }).from(schema.leases).where(eq(schema.leases.id, leaseId)))[0]!;
    const unsignedDocumentId = await fileDocument(tx, leaseId, input.kind, `${label} ${lease.ref} (for signing).pdf`, key, pdf);
    const [envelope] = await tx
      .insert(schema.signingEnvelopes)
      .values({
        leaseId,
        kind: input.kind,
        landlordSignatory: input.kind === "lease_agreement" ? input.landlordSignatory : null,
        title: built.content.title,
        content: built.content as unknown as Record<string, unknown>,
        documentSha256: sha256(pdf),
        unsignedDocumentId,
      })
      .returning();
    const rows = await tx
      .insert(schema.signers)
      .values(built.signers.map((s) => ({ ...s, envelopeId: envelope!.id })))
      .returning();
    const first = Math.min(...rows.map((r) => r.position));
    for (const s of rows.filter((r) => r.position === first)) await invite(tx, envelope!, s);
    await audit(tx, {
      action: "document.sent_for_signing",
      entity: "lease",
      entityId: leaseId,
      after: { envelopeId: envelope!.id, kind: input.kind, sha256: envelope!.documentSha256, signers: rows.map((r) => `${r.position}:${r.role}:${r.name}`) },
    });
    return envelope!.id;
  });
}

export async function listEnvelopes(actor: Actor, leaseId: string) {
  authorise(actor, "documents.view");
  return withAgency({ ...actor.ctx, readOnly: true }, async (tx) => {
    await assertLeaseInScope(tx, actor, leaseId);
    const envelopes = await tx.select().from(schema.signingEnvelopes).where(eq(schema.signingEnvelopes.leaseId, leaseId)).orderBy(desc(schema.signingEnvelopes.createdAt));
    if (envelopes.length === 0) return [];
    const all = await tx
      .select()
      .from(schema.signers)
      .where(inArray(schema.signers.envelopeId, envelopes.map((e) => e.id)))
      .orderBy(asc(schema.signers.position), asc(schema.signers.createdAt));
    return envelopes.map(({ content: _content, ...e }) => ({
      ...e,
      signers: all
        .filter((s) => s.envelopeId === e.id)
        .map((s) => ({ id: s.id, position: s.position, role: s.role, name: s.name, capacity: s.capacity, status: s.status, invitedAt: s.invitedAt, signedAt: s.signedAt, declineReason: s.declineReason })),
    }));
  });
}

async function lockEnvelope(tx: Tx, envelopeId: string) {
  const [e] = await tx.select().from(schema.signingEnvelopes).where(eq(schema.signingEnvelopes.id, envelopeId)).for("update");
  if (!e) throw new NotFoundError("Document");
  return e;
}

export async function cancelEnvelope(actor: Actor, envelopeId: string, reason: string): Promise<void> {
  authorise(actor, "documents.prepare");
  await withAgency(actor.ctx, async (tx) => {
    const e = await lockEnvelope(tx, envelopeId);
    await assertLeaseInScope(tx, actor, e.leaseId);
    if (e.status !== "out_for_signing") throw new SigningError("Only a document still out for signing can be cancelled.");
    await tx.update(schema.signingEnvelopes).set({ status: "cancelled", cancelledAt: sql`now()`, cancelReason: reason }).where(eq(schema.signingEnvelopes.id, e.id));
    await audit(tx, { action: "document.signing_cancelled", entity: "lease", entityId: e.leaseId, after: { envelopeId, reason } });
  });
}

/** A new link for a signer whose invitation was lost or expired; the old link stops working. */
export async function resendInvitation(actor: Actor, signerId: string): Promise<void> {
  authorise(actor, "documents.prepare");
  await withAgency(actor.ctx, async (tx) => {
    const [s] = await tx.select().from(schema.signers).where(eq(schema.signers.id, signerId));
    if (!s) throw new NotFoundError("Signer");
    const e = await lockEnvelope(tx, s.envelopeId);
    await assertLeaseInScope(tx, actor, e.leaseId);
    if (e.status !== "out_for_signing" || s.status !== "invited") throw new SigningError("Only a signer who has been invited and not yet signed can get a new link.");
    await invite(tx, e, s);
    await audit(tx, { action: "document.signing_link_resent", entity: "lease", entityId: e.leaseId, after: { envelopeId: e.id, signer: s.name } });
  });
}

// ─── The signer's side (public, on the agency's host) ──────────────────
// The agency comes from the host; the token only finds a signer within it.

const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

async function signerByToken(tx: Tx, token: string, lock = false) {
  if (!TOKEN_RE.test(token)) return null;
  const q = tx
    .select({ signer: schema.signers, envelope: schema.signingEnvelopes })
    .from(schema.signers)
    .innerJoin(schema.signingEnvelopes, eq(schema.signingEnvelopes.id, schema.signers.envelopeId))
    .where(eq(schema.signers.tokenHash, sha256(token)));
  const [row] = lock ? await q.for("update") : await q;
  return row ?? null;
}

const linkUsable = (s: typeof schema.signers.$inferSelect) => !!s.tokenExpiresAt && s.tokenExpiresAt.getTime() > Date.now();

export interface SigningView {
  title: string;
  kind: GeneratedKind;
  envelopeStatus: string;
  documentSha256: string;
  signer: { name: string; capacity: string; status: string; codeSentTo: string | null; verified: boolean };
  others: { name: string; capacity: string; status: string }[];
  canSign: boolean;
  expired: boolean;
}

const maskEmail = (e: string) => e.replace(/^(.)[^@]*(@.*)$/, "$1***$2");
const maskPhone = (p: string) => `***${p.slice(-4)}`;
const codeTarget = (s: typeof schema.signers.$inferSelect) =>
  s.email ? { channel: "email" as const, to: s.email, shown: maskEmail(s.email) } : s.phone ? { channel: "sms" as const, to: s.phone, shown: maskPhone(s.phone) } : null;

export async function signingView(agencyId: string, token: string): Promise<SigningView | null> {
  return withAgency({ agencyId, readOnly: true }, async (tx) => {
    const row = await signerByToken(tx, token);
    if (!row) return null;
    const { signer: s, envelope: e } = row;
    const others = await tx
      .select({ name: schema.signers.name, capacity: schema.signers.capacity, status: schema.signers.status, id: schema.signers.id })
      .from(schema.signers)
      .where(eq(schema.signers.envelopeId, e.id))
      .orderBy(asc(schema.signers.position));
    const verified = !!s.codeVerifiedAt && s.codeVerifiedAt.getTime() > Date.now() - VERIFIED_MINUTES * 60_000;
    const expired = !linkUsable(s);
    return {
      title: e.title,
      kind: e.kind,
      envelopeStatus: e.status,
      documentSha256: e.documentSha256,
      signer: { name: s.name, capacity: s.capacity, status: s.status, codeSentTo: codeTarget(s)?.shown ?? null, verified },
      others: others.filter((o) => o.id !== s.id).map(({ id: _id, ...o }) => o),
      canSign: e.status === "out_for_signing" && s.status === "invited" && !expired,
      expired,
    };
  });
}

/** The file a signer may download: the version for signing, or the signed original once complete. */
export async function signingDocument(agencyId: string, token: string): Promise<{ bytes: Uint8Array; filename: string } | null> {
  const doc = await withAgency({ agencyId, readOnly: true }, async (tx) => {
    const row = await signerByToken(tx, token);
    if (!row || !linkUsable(row.signer) || row.envelope.status === "cancelled") return null;
    const id = row.envelope.signedDocumentId ?? row.envelope.unsignedDocumentId;
    const [d] = await tx.select().from(schema.documents).where(eq(schema.documents.id, id));
    return d ?? null;
  });
  if (!doc) return null;
  return { bytes: await readObject(doc.fileKey), filename: doc.filename };
}

const codeHash = (signerId: string, code: string) => createHmac("sha256", env().PORTAL_AUTH_SECRET).update(`sign:${signerId}:${code}`).digest("base64url");

/** Sends the signer a one-time code (at most one a minute), by email if we have one, else SMS. */
export async function sendSigningCode(agencyId: string, token: string, providers: Providers = defaultProviders()): Promise<{ sentTo: string } | null> {
  const prepared = await withAgency({ agencyId }, async (tx) => {
    const row = await signerByToken(tx, token, true);
    if (!row || row.envelope.status !== "out_for_signing" || row.signer.status !== "invited" || !linkUsable(row.signer)) return null;
    const s = row.signer;
    const target = codeTarget(s);
    if (!target) return null;
    if (s.codeExpiresAt && s.codeExpiresAt.getTime() - CODE_MINUTES * 60_000 > Date.now() - 60_000) return { skip: true as const, target, s, title: row.envelope.title };
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await tx
      .update(schema.signers)
      .set({ codeHash: codeHash(s.id, code), codeExpiresAt: sql`now() + interval '${sql.raw(String(CODE_MINUTES))} minutes'`, codeAttempts: 0 })
      .where(eq(schema.signers.id, s.id));
    const [agency] = await tx.select().from(schema.agencies);
    return { skip: false as const, target, s, code, agency: agency!, title: row.envelope.title };
  });
  if (!prepared) return null;
  if (prepared.skip) return { sentTo: prepared.target.shown };
  const { target, s, code, agency } = prepared;
  const messageId = crypto.randomUUID();
  const sent =
    target.channel === "sms"
      ? await providers.sms({ messageId, from: agency.smsSenderName, to: target.to, text: toGsm(`${code} is your code to sign the document from ${agency.name}. It expires in 10 minutes.`) })
      : await providers.email({
          messageId,
          fromName: agency.name,
          replyTo: agency.contactEmail,
          to: target.to,
          subject: `Your code to sign: ${prepared.title}`,
          ...renderEmail(emailBrand(agency), `Your code to sign ${prepared.title} is ${code}\n\nIt expires in 10 minutes. Do not share it with anyone.`, null),
          attachments: [],
        });
  await withAgency({ agencyId }, async (tx) => {
    await tx.insert(schema.messages).values({
      id: messageId,
      batchId: messageId,
      templateKey: "signing_code",
      channel: target.channel,
      recipientKind: s.role === "tenant" ? "tenant" : s.role === "owner" ? "owner" : "staff",
      recipientId: s.partyId,
      recipientName: s.name,
      toAddress: target.to,
      body: "Signing code (not shown)",
      payload: {},
      status: "sent",
      attempts: 1,
      provider: sent.provider,
      providerId: sent.providerId,
      sentAt: sql`now()`,
    });
    await countUsage(tx, target.channel);
  });
  return { sentTo: target.shown };
}

export async function verifySigningCode(agencyId: string, token: string, code: string): Promise<"ok" | "wrong" | "expired" | "locked"> {
  return withAgency({ agencyId }, async (tx) => {
    const row = await signerByToken(tx, token, true);
    if (!row || row.signer.status !== "invited" || row.envelope.status !== "out_for_signing" || !linkUsable(row.signer)) return "expired";
    const s = row.signer;
    if (!s.codeHash || !s.codeExpiresAt || s.codeExpiresAt.getTime() < Date.now()) return "expired";
    if (s.codeAttempts >= CODE_TRIES) return "locked";
    const a = Buffer.from(s.codeHash);
    const b = Buffer.from(codeHash(s.id, code.trim()));
    if (!/^\d{6}$/.test(code.trim()) || a.length !== b.length || !timingSafeEqual(a, b)) {
      await tx.update(schema.signers).set({ codeAttempts: s.codeAttempts + 1 }).where(eq(schema.signers.id, s.id));
      return s.codeAttempts + 1 >= CODE_TRIES ? "locked" : "wrong";
    }
    await tx.update(schema.signers).set({ codeVerifiedAt: sql`now()`, codeHash: null }).where(eq(schema.signers.id, s.id));
    return "ok";
  });
}

export const signSchema = z.object({
  signedName: z.string().trim().min(2, "Type your full name").max(120),
  consent: z.literal(true, { error: "Confirm that you agree to sign electronically" }),
});

/** The signer signs. Invites the next signers, or completes the document if they were the last (D49). */
export async function signDocument(
  agencyId: string,
  token: string,
  input: { signedName: string; signaturePng: Uint8Array; ipAddress: string; userAgent: string },
): Promise<"signed" | "completed"> {
  const type = detectFileType(input.signaturePng);
  if (type?.contentType !== "image/png" || input.signaturePng.byteLength > MAX_SIGNATURE_BYTES || input.signaturePng.byteLength < 100) {
    throw new SigningError("Draw your signature in the box.");
  }
  const signatureKey = await putGenerated(agencyId, input.signaturePng, "image/png", "png");
  const outcome = await withAgency({ agencyId }, async (tx) => {
    const row = await signerByToken(tx, token);
    if (!row) throw new NotFoundError("Signing link");
    // One signature at a time per document, so the last two co-tenants cannot both miss the hand-over
    const e = await lockEnvelope(tx, row.envelope.id);
    const [s] = await tx.select().from(schema.signers).where(eq(schema.signers.id, row.signer.id)).for("update");
    if (e.status !== "out_for_signing" || s!.status !== "invited" || !linkUsable(s!)) throw new SigningError("This link can no longer be used to sign.");
    if (!s!.codeVerifiedAt || s!.codeVerifiedAt.getTime() < Date.now() - VERIFIED_MINUTES * 60_000) throw new SigningError("Confirm the code we sent you first.");
    await tx
      .update(schema.signers)
      .set({
        status: "signed",
        signedAt: sql`now()`,
        signedName: input.signedName.trim(),
        signatureKey,
        ipAddress: input.ipAddress.slice(0, 64),
        userAgent: input.userAgent.slice(0, 400),
      })
      .where(eq(schema.signers.id, s!.id));
    await audit(tx, {
      action: "document.signed",
      entity: "lease",
      entityId: e.leaseId,
      after: { envelopeId: e.id, signer: s!.name, role: s!.role, sha256: e.documentSha256, ipAddress: input.ipAddress },
    });
    const all = await tx.select().from(schema.signers).where(eq(schema.signers.envelopeId, e.id)).orderBy(asc(schema.signers.position));
    const pending = all.filter((x) => x.status !== "signed");
    if (pending.some((x) => x.status === "invited")) return { done: false as const };
    if (pending.length) {
      const next = Math.min(...pending.map((x) => x.position));
      for (const x of pending.filter((p) => p.position === next)) await invite(tx, e, x);
      return { done: false as const };
    }
    return { done: true as const, envelope: e, signers: all };
  });
  if (!outcome.done) return "signed";
  try {
    await complete(agencyId, outcome.envelope, outcome.signers);
  } catch (err) {
    // The signature is saved; staff can finish the document from the lease page
    console.error(`[signing] could not complete envelope ${outcome.envelope.id}`, err);
    return "signed";
  }
  return "completed";
}

/** Staff finish a document everyone has signed whose signed copy could not be built at the time. */
export async function finishEnvelope(actor: Actor, envelopeId: string): Promise<void> {
  authorise(actor, "documents.prepare");
  const ready = await withAgency({ ...actor.ctx, readOnly: true }, async (tx) => {
    const [e] = await tx.select().from(schema.signingEnvelopes).where(eq(schema.signingEnvelopes.id, envelopeId));
    if (!e) throw new NotFoundError("Document");
    await assertLeaseInScope(tx, actor, e.leaseId);
    const all = await tx.select().from(schema.signers).where(eq(schema.signers.envelopeId, e.id)).orderBy(asc(schema.signers.position));
    if (e.status !== "out_for_signing" || all.some((s) => s.status !== "signed")) throw new SigningError("Not everyone has signed yet.");
    return { e, all };
  });
  await complete(actor.ctx.agencyId, ready.e, ready.all);
}

/** Builds the signed original with the certificate, files it and sends every signer a copy. */
async function complete(
  agencyId: string,
  envelope: typeof schema.signingEnvelopes.$inferSelect,
  signers: (typeof schema.signers.$inferSelect)[],
): Promise<void> {
  const content = envelope.content as unknown as EnvelopeContent;
  const signatures: (AppliedSignature | null)[] = [];
  for (const s of signers) signatures.push({ signedName: s.signedName!, signedAt: dateTime(s.signedAt!), image: Buffer.from(await readObject(s.signatureKey!)) });
  const completedAt = new Date();
  const certificate: Certificate = {
    envelopeId: envelope.id,
    documentSha256: envelope.documentSha256,
    completedAt: dateTime(completedAt),
    signers: signers.map((s) => ({
      // The name typed when signing, and the record's name if different
      name: s.signedName!.trim().toLowerCase() === s.name.trim().toLowerCase() ? s.name : `${s.signedName} (${s.name})`,
      capacity: s.capacity,
      contact: s.email ? maskEmail(s.email) : s.phone ? maskPhone(s.phone) : "",
      signedAt: dateTime(s.signedAt!),
      ipAddress: s.ipAddress ?? "",
      userAgent: s.userAgent ?? "",
    })),
  };
  const pdf = new Uint8Array(await renderEnvelopeDocument(await loadBrand(agencyId), content, { signatures, certificate }));
  const key = await putGenerated(agencyId, pdf, "application/pdf", "pdf");
  await withAgency({ agencyId }, async (tx) => {
    const e = await lockEnvelope(tx, envelope.id);
    if (e.status !== "out_for_signing") return;
    const [lease] = await tx.select({ ref: schema.leases.eftReference }).from(schema.leases).where(eq(schema.leases.id, e.leaseId));
    const label = e.kind === "lease_agreement" ? "Lease agreement" : "Lease confirmation letter";
    const docId = await fileDocument(tx, e.leaseId, e.kind, `${label} ${lease!.ref} (signed).pdf`, key, pdf);
    await tx.update(schema.signingEnvelopes).set({ status: "completed", completedAt: completedAt, signedDocumentId: docId }).where(eq(schema.signingEnvelopes.id, e.id));
    await audit(tx, { action: "document.signing_completed", entity: "lease", entityId: e.leaseId, after: { envelopeId: e.id, signedSha256: sha256(pdf) } });
    const unit = await unitName(tx, e.leaseId);
    for (const s of signers) {
      await send(tx, {
        recipient: recipientFor(s),
        templateKey: "signing_completed",
        leaseId: e.leaseId,
        transactional: true,
        attachmentDocumentId: docId,
        variables: { name: s.name.trim().split(/\s+/)[0]!, document: KIND_LABEL[e.kind], unit },
      });
    }
  });
}

export const declineSchema = z.object({ reason: z.string().trim().min(3, "Say why, so the agent can fix it").max(500) });

/** The signer declines; the document is withdrawn and the sender told (D85). */
export async function declineSigning(agencyId: string, token: string, reason: string): Promise<void> {
  await withAgency({ agencyId }, async (tx) => {
    const row = await signerByToken(tx, token);
    if (!row) throw new NotFoundError("Signing link");
    const e = await lockEnvelope(tx, row.envelope.id);
    if (e.status !== "out_for_signing" || row.signer.status !== "invited" || !linkUsable(row.signer)) throw new SigningError("This link can no longer be used.");
    if (!row.signer.codeVerifiedAt) throw new SigningError("Confirm the code we sent you first.");
    await tx.update(schema.signers).set({ status: "declined", declinedAt: sql`now()`, declineReason: reason }).where(eq(schema.signers.id, row.signer.id));
    await tx.update(schema.signingEnvelopes).set({ status: "declined" }).where(eq(schema.signingEnvelopes.id, e.id));
    await audit(tx, { action: "document.signing_declined", entity: "lease", entityId: e.leaseId, after: { envelopeId: e.id, signer: row.signer.name, reason } });
    if (e.createdBy) {
      await send(tx, {
        recipient: { kind: "staff", userId: e.createdBy },
        templateKey: "signing_declined",
        leaseId: e.leaseId,
        variables: { signer: row.signer.name, document: KIND_LABEL[e.kind], unit: await unitName(tx, e.leaseId), reason },
      });
    }
  });
}

/** Staff and agents who can be chosen as signers on this agency's documents. */
export async function signingStaff(actor: Actor) {
  authorise(actor, "documents.prepare");
  return withAgency({ ...actor.ctx, readOnly: true }, (tx) =>
    tx
      .select({ id: schema.users.id, name: schema.users.name, role: schema.users.role })
      .from(schema.users)
      .where(and(eq(schema.users.active, true), inArray(schema.users.role, ["admin", "agent"])))
      .orderBy(asc(schema.users.name)),
  );
}
