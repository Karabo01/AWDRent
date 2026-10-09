import { createHash } from "node:crypto";
import { env } from "@awdrent/config";
import { publicAgencyBySubdomain, schema, type Tx, withAgency } from "@awdrent/db";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { type ParsedMail, simpleParser } from "mailparser";
import { audit } from "./audit";
import { todayInSouthAfrica } from "./billing";
import { cleanFilename, detectFileType } from "./file-types";
import { parseRandToCents } from "./money";
import { type PopClaim, recordPop } from "./pops";
import { type Actor, authorise, NotFoundError } from "./portfolio";
import { deleteObject, MAX_UPLOAD_BYTES, putQuarantined } from "./storage";

// The POP inbox (spec; D37, D87–D90). The worker hands every email from the
// AWDRent mailbox to receiveEmail(): it finds the agency from the
// pop+{subdomain}@ address, stores the PDF and image attachments (virus
// scanned like any upload), and works out which lease and amount the email
// is about. An email naming exactly one lease and one amount becomes a proof
// of payment straight away; anything else waits in the agency's inbox for
// accounts. Emails are untrusted: the sender is only ever a hint, and a POP
// changes no balance until accounts link it to a bank line (D33).

export const MAX_ATTACHMENTS = 5;
const EXCERPT_CHARS = 1500;

export class InboxError extends Error {}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The agency subdomain an email was sent to: pop+kgosi@awdrent.co.za → "kgosi". */
export function subdomainFromRecipients(recipients: string[], inboxAddress = env().POP_INBOX_ADDRESS): string | null {
  const [local, domain] = inboxAddress.toLowerCase().split("@");
  if (!local || !domain) return null;
  const re = new RegExp(`(?:^|[^a-z0-9._%+-])${escapeRe(local)}\\+([a-z0-9-]{1,32})@${escapeRe(domain)}(?![a-z0-9.-])`, "i");
  for (const r of recipients) {
    const m = re.exec(r.toLowerCase());
    if (m) return m[1]!;
  }
  return null;
}

/** Every recipient header a forwarded email may carry the plus-address in. */
export function recipientHeaders(mail: ParsedMail): string[] {
  const out: string[] = [];
  for (const key of ["delivered-to", "x-original-to", "x-forwarded-to", "envelope-to", "x-envelope-to", "to", "cc"]) {
    const value = mail.headers.get(key);
    const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
    for (const v of values) {
      if (typeof v === "string") out.push(v);
      else if (v && typeof v === "object" && "text" in v && typeof v.text === "string") out.push(v.text);
    }
  }
  return out;
}

/** Rand amounts written in the email ("R8 500,00", "R 8,500.00", "r8500"), distinct, in cents. */
export function amountsIn(text: string): number[] {
  const found = new Set<number>();
  for (const m of text.matchAll(/(?:^|[^A-Za-z0-9])R\s?(\d{1,3}(?:[\s,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?![\d])/gi)) {
    const cents = parseRandToCents(m[1]!.replace(/\s/g, " "));
    if (cents !== null && cents > 0 && cents <= 1_000_000_000) found.add(cents);
  }
  return [...found];
}

/** Leases whose payment reference appears in the text, allowing "KL 42", "kl0042" for KL-0042. */
export function referencesIn(text: string, leases: { id: string; eftReference: string }[]): string[] {
  const upper = text.toUpperCase();
  const ids = new Set<string>();
  for (const l of leases) {
    const m = /^([A-Z]+)-0*(\d+)$/.exec(l.eftReference);
    const pattern = m ? `${m[1]}[\\s-]?0*${m[2]}` : escapeRe(l.eftReference);
    if (new RegExp(`(?:^|[^A-Z0-9])${pattern}(?![0-9])`).test(upper)) ids.add(l.id);
  }
  return [...ids];
}

const textOf = (mail: ParsedMail) =>
  (mail.text ?? (typeof mail.html === "string" ? mail.html.replace(/<[^>]+>/g, " ") : "")).replace(/\s+/g, " ").trim();

interface Match {
  leaseId: string | null;
  tenantId: string | null;
  reason: string | null;
}

async function matchLease(tx: Tx, from: string, haystack: string): Promise<Match> {
  const leases = await tx.select({ id: schema.leases.id, eftReference: schema.leases.eftReference }).from(schema.leases).where(ne(schema.leases.status, "draft"));
  const byRef = referencesIn(haystack, leases);
  if (byRef.length === 1) {
    const ref = leases.find((l) => l.id === byRef[0])!.eftReference;
    const [tenant] = await tx
      .select({ id: schema.tenants.id })
      .from(schema.leaseTenants)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.leaseTenants.tenantId))
      .where(and(eq(schema.leaseTenants.leaseId, byRef[0]!), sql`lower(${schema.tenants.email}) = ${from}`));
    return { leaseId: byRef[0]!, tenantId: tenant?.id ?? null, reason: `Payment reference ${ref} in the email` };
  }
  if (byRef.length > 1) return { leaseId: null, tenantId: null, reason: "Mentions more than one payment reference" };
  // No reference: the sender's address, if it is one tenant's with one current lease
  const tenants = await tx.select({ id: schema.tenants.id }).from(schema.tenants).where(sql`lower(${schema.tenants.email}) = ${from}`);
  if (tenants.length !== 1) return { leaseId: null, tenantId: null, reason: tenants.length ? "Sent from an address several tenants share" : null };
  const theirs = await tx
    .select({ id: schema.leases.id })
    .from(schema.leaseTenants)
    .innerJoin(schema.leases, eq(schema.leases.id, schema.leaseTenants.leaseId))
    .where(and(eq(schema.leaseTenants.tenantId, tenants[0]!.id), inArray(schema.leases.status, ["active", "notice_given"])));
  if (theirs.length !== 1) return { leaseId: null, tenantId: tenants[0]!.id, reason: "Sent by a tenant with more than one current lease" };
  return { leaseId: theirs[0]!.id, tenantId: tenants[0]!.id, reason: "Sent from the tenant's email address" };
}

/** Moves the email's files to the lease and records the POP with the first of them. */
async function convertInTx(tx: Tx, emailId: string, leaseId: string, tenantId: string | null, claim: PopClaim, resolvedBy: string | null = null): Promise<string> {
  const docs = await tx
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(and(eq(schema.documents.inboundEmailId, emailId), sql`${schema.documents.status} in ('pending_scan', 'clean')`))
    .orderBy(schema.documents.createdAt);
  if (docs.length === 0) throw new InboxError("This email has no usable attachment to use as the proof of payment.");
  await tx
    .update(schema.documents)
    .set({ leaseId, inboundEmailId: null })
    .where(eq(schema.documents.inboundEmailId, emailId));
  // The tenant is kept only if they are on this lease
  let tenant = tenantId;
  if (tenant) {
    const [on] = await tx
      .select({ id: schema.leaseTenants.id })
      .from(schema.leaseTenants)
      .where(and(eq(schema.leaseTenants.leaseId, leaseId), eq(schema.leaseTenants.tenantId, tenant)));
    if (!on) tenant = null;
  }
  const popId = await recordPop(tx, { leaseId, tenantId: tenant, documentId: docs[0]!.id, claim, via: "email" });
  await tx.update(schema.inboundEmails).set({ status: "converted", popId, resolvedAt: sql`now()`, resolvedBy }).where(eq(schema.inboundEmails.id, emailId));
  return popId;
}

export type ReceiveOutcome =
  | { outcome: "not_for_an_agency" }
  | { outcome: "duplicate"; agencyId: string }
  | { outcome: "converted" | "inbox"; agencyId: string; inboundEmailId: string; documentIds: string[] };

/**
 * Worker step for one raw email from the AWDRent mailbox. Safe to repeat:
 * an email already recorded (same Message-ID) is skipped. The caller queues
 * virus scans for the returned documents.
 */
export async function receiveEmail(raw: Buffer): Promise<ReceiveOutcome> {
  const mail = await simpleParser(raw, { skipHtmlToText: false });
  const subdomain = subdomainFromRecipients(recipientHeaders(mail));
  const agency = subdomain ? await publicAgencyBySubdomain(subdomain) : null;
  if (!agency || agency.status !== "active") return { outcome: "not_for_an_agency" };
  const agencyId = agency.id;
  const messageId = (mail.messageId ?? `sha256:${createHash("sha256").update(raw).digest("hex")}`).slice(0, 300);

  const [seen] = await withAgency({ agencyId, readOnly: true }, (tx) =>
    tx.select({ id: schema.inboundEmails.id }).from(schema.inboundEmails).where(eq(schema.inboundEmails.messageId, messageId)),
  );
  if (seen) return { outcome: "duplicate", agencyId };

  // Only PDFs and images, checked by their content; inline images (signature logos) are skipped
  const files = (mail.attachments ?? [])
    .filter((a) => a.contentType === "application/pdf" || !(a.related || (a.contentDisposition === "inline" && a.cid)))
    .map((a) => ({ name: a.filename ?? "attachment", bytes: new Uint8Array(a.content), type: detectFileType(new Uint8Array(a.content)) }))
    .filter((f) => f.type && f.bytes.byteLength > 0 && f.bytes.byteLength <= MAX_UPLOAD_BYTES)
    .slice(0, MAX_ATTACHMENTS);
  const stored: { key: string; name: string; bytes: Uint8Array; contentType: string; extension: string }[] = [];
  for (const f of files) {
    stored.push({ key: await putQuarantined(agencyId, f.bytes, f.type!.contentType, f.type!.extension), name: f.name, bytes: f.bytes, ...f.type! });
  }

  const from = (mail.from?.value[0]?.address ?? "").toLowerCase().slice(0, 254);
  const text = textOf(mail);
  const subject = (mail.subject ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || "(no subject)";
  const receivedAt = mail.date && !Number.isNaN(mail.date.getTime()) && mail.date.getTime() <= Date.now() + 86_400_000 ? mail.date : new Date();
  try {
    return await withAgency({ agencyId }, async (tx) => {
      const match = await matchLease(tx, from, [subject, text, ...files.map((f) => f.name)].join(" \n "));
      const amounts = amountsIn(`${subject} ${text}`);
      const [email] = await tx
        .insert(schema.inboundEmails)
        .values({
          messageId,
          fromAddress: from || "(unknown sender)",
          fromName: mail.from?.value[0]?.name?.slice(0, 200) || null,
          subject,
          receivedAt,
          excerpt: text.slice(0, EXCERPT_CHARS),
          suggestedLeaseId: match.leaseId,
          suggestedTenantId: match.tenantId,
          matchReason: match.reason,
          suggestedCents: amounts.length === 1 ? amounts[0]! : null,
        })
        .onConflictDoNothing()
        .returning();
      if (!email) throw new DuplicateEmail();
      const documentIds: string[] = [];
      for (const f of stored) {
        const [doc] = await tx
          .insert(schema.documents)
          .values({
            inboundEmailId: email.id,
            kind: "proof_of_payment",
            filename: cleanFilename(f.name, f.extension),
            contentType: f.contentType,
            sizeBytes: f.bytes.byteLength,
            sha256: createHash("sha256").update(f.bytes).digest("hex"),
            fileKey: f.key,
          })
          .returning({ id: schema.documents.id });
        documentIds.push(doc!.id);
      }
      await audit(tx, {
        action: "pop_email.received",
        entity: "inbound_email",
        entityId: email.id,
        after: { from, subject, attachments: documentIds.length, match: match.reason, amounts: amounts.length },
      });
      if (match.leaseId && amounts.length === 1 && documentIds.length > 0) {
        const paidOn = todayInSouthAfrica(receivedAt);
        await convertInTx(tx, email.id, match.leaseId, match.tenantId, { amount: amounts[0]!, paidOn, reference: subject.slice(0, 80) });
        return { outcome: "converted", agencyId, inboundEmailId: email.id, documentIds };
      }
      return { outcome: "inbox", agencyId, inboundEmailId: email.id, documentIds };
    });
  } catch (err) {
    for (const f of stored) await deleteObject(f.key).catch(() => undefined);
    if (err instanceof DuplicateEmail) return { outcome: "duplicate", agencyId };
    throw err;
  }
}

class DuplicateEmail extends Error {}

// ─── The agency's inbox (accounts) ──────────────────────────────────────

export async function listInbox(actor: Actor, status: "new" | "converted" | "dismissed" = "new") {
  authorise(actor, "payments.approve");
  return withAgency({ ...actor.ctx, readOnly: true }, async (tx) => {
    const emails = await tx
      .select({ email: schema.inboundEmails, suggestedRef: schema.leases.eftReference })
      .from(schema.inboundEmails)
      .leftJoin(schema.leases, eq(schema.leases.id, schema.inboundEmails.suggestedLeaseId))
      .where(eq(schema.inboundEmails.status, status))
      .orderBy(desc(schema.inboundEmails.receivedAt))
      .limit(100);
    if (emails.length === 0) return [];
    const docs = await tx
      .select({ id: schema.documents.id, inboundEmailId: schema.documents.inboundEmailId, filename: schema.documents.filename, status: schema.documents.status })
      .from(schema.documents)
      .where(inArray(schema.documents.inboundEmailId, emails.map((e) => e.email.id)));
    return emails.map((e) => ({ ...e.email, suggestedRef: e.suggestedRef, attachments: docs.filter((d) => d.inboundEmailId === e.email.id) }));
  });
}

/** Accounts complete an emailed POP: which lease, how much, paid when. */
export async function convertInboundEmail(actor: Actor, emailId: string, input: { eftReference: string; claim: PopClaim }): Promise<string> {
  authorise(actor, "payments.approve");
  return withAgency(actor.ctx, async (tx) => {
    const [email] = await tx.select().from(schema.inboundEmails).where(eq(schema.inboundEmails.id, emailId)).for("update");
    if (!email) throw new NotFoundError("Email");
    if (email.status !== "new") throw new InboxError("This email has already been dealt with.");
    const [lease] = await tx
      .select({ id: schema.leases.id })
      .from(schema.leases)
      .where(and(sql`upper(${schema.leases.eftReference}) = ${input.eftReference.trim().toUpperCase()}`, ne(schema.leases.status, "draft")));
    if (!lease) throw new InboxError(`No lease has the payment reference ${input.eftReference.trim()}.`);
    return convertInTx(tx, email.id, lease.id, email.suggestedTenantId, input.claim, actor.userId);
  });
}

export async function dismissInboundEmail(actor: Actor, emailId: string, note: string): Promise<void> {
  authorise(actor, "payments.approve");
  await withAgency(actor.ctx, async (tx) => {
    const [email] = await tx.select().from(schema.inboundEmails).where(eq(schema.inboundEmails.id, emailId)).for("update");
    if (!email) throw new NotFoundError("Email");
    if (email.status !== "new") throw new InboxError("This email has already been dealt with.");
    await tx
      .update(schema.inboundEmails)
      .set({ status: "dismissed", note, resolvedAt: sql`now()`, resolvedBy: actor.userId })
      .where(eq(schema.inboundEmails.id, email.id));
    await audit(tx, { action: "pop_email.dismissed", entity: "inbound_email", entityId: email.id, after: { note } });
  });
}

/** The address an agency forwards its pop@ mail to (D37). */
export function inboxAddressFor(subdomain: string, inboxAddress = env().POP_INBOX_ADDRESS): string {
  const [local, domain] = inboxAddress.split("@");
  return `${local}+${subdomain}@${domain}`;
}
