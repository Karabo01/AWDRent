import { type AgencyContext, schema, type Tx, withAgency, withPlatform } from "@awdrent/db";
import { and, desc, eq, ilike, isNotNull, isNull, ne, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { trustAccountNumber } from "./agency-settings";
import { audit } from "./audit";
import { todayInSouthAfrica } from "./billing";
import { storeUpload } from "./documents";
import { ledgerInTx } from "./ledger";
import { countUsage, emailBrand, unitName } from "./messages";
import { defaultProviders, type Providers } from "./messaging/providers";
import { renderEmail, toGsm, toMsisdn } from "./messaging/render";
import { type PopClaim, recordPop } from "./pops";
import { NotFoundError } from "./portfolio";
import { renderStatementPdf } from "./receipts";
import { signedDownloadUrl } from "./storage";

// The tenant portal (spec "Renter"; D41, D76–D80). A tenant signs in with a
// one-time code and then sees only leases they are on: balance, statement,
// receipts, payment details, proof-of-payment upload, and their message
// consent. Every call takes a PortalActor built from the verified portal
// session; the agency comes from that session, never from the request.

export interface PortalActor {
  /** agencyId and portalUserId from the verified session (audit entries name the portal user). */
  ctx: AgencyContext & { portalUserId: string };
  tenantId: string;
}

// ─── Signing in ────────────────────────────────────────────────────────

export type SignInIdentifier = { kind: "email"; value: string } | { kind: "phone"; value: string };

/** "Ayanda@Example.com " → email; "082 123 4567" → phone 27821234567; anything else → null. */
export function parseSignInIdentifier(raw: string): SignInIdentifier | null {
  const s = raw.trim();
  if (s.includes("@")) {
    const email = s.toLowerCase();
    return z.email().safeParse(email).success && email.length <= 254 ? { kind: "email", value: email } : null;
  }
  const msisdn = toMsisdn(s);
  return msisdn ? { kind: "phone", value: msisdn } : null;
}

export interface SignInTarget {
  tenantId: string;
  name: string;
  channel: "email" | "sms";
  to: string;
}

/** Tenants who may use the portal: not archived, on at least one lease past draft (D76). */
function eligible(tx: Tx, where: SQL) {
  return tx
    .selectDistinct({ id: schema.tenants.id, name: schema.tenants.fullName, email: schema.tenants.email, phone: schema.tenants.phone })
    .from(schema.tenants)
    .innerJoin(schema.leaseTenants, eq(schema.leaseTenants.tenantId, schema.tenants.id))
    .innerJoin(schema.leases, eq(schema.leases.id, schema.leaseTenants.leaseId))
    .where(and(isNull(schema.tenants.archivedAt), ne(schema.leases.status, "draft"), where));
}

/**
 * The tenant an email address or phone number signs in, within one agency.
 * Null when there is none, or when several tenant records share it: the code
 * must never open someone else's account (D76).
 */
export async function findSignInTarget(agencyId: string, id: SignInIdentifier): Promise<SignInTarget | null> {
  return withAgency({ agencyId, readOnly: true }, async (tx) => {
    let matches: { id: string; name: string; email: string | null; phone: string | null }[];
    if (id.kind === "email") {
      const like = id.value.replace(/[%_\\]/g, "\\$&");
      matches = await eligible(tx, ilike(schema.tenants.email, like));
    } else {
      const withPhone = await eligible(tx, isNotNull(schema.tenants.phone));
      matches = withPhone.filter((t) => toMsisdn(t.phone) === id.value);
    }
    if (matches.length !== 1) return null;
    const t = matches[0]!;
    return { tenantId: t.id, name: t.name, channel: id.kind === "email" ? "email" : "sms", to: id.kind === "email" ? t.email! : id.value };
  });
}

/**
 * Sends a sign-in code straight away (no quiet hours: the tenant just asked
 * for it), on the channel they signed in with, whatever their message
 * opt-ins (D79). Logged and counted like any message, but the code itself is
 * never stored in the log.
 */
export async function sendSignInCode(agencyId: string, target: SignInTarget, code: string, providers: Providers = defaultProviders()): Promise<void> {
  const agency = await withAgency({ agencyId, readOnly: true }, async (tx) => (await tx.select().from(schema.agencies))[0]!);
  const subject = `Your ${agency.name} sign-in code`;
  const messageId = crypto.randomUUID();
  const sent =
    target.channel === "sms"
      ? await providers.sms({
          messageId,
          from: agency.smsSenderName,
          to: target.to,
          text: toGsm(`${code} is your ${agency.name} sign-in code. It expires in 10 minutes. Never share it with anyone.`),
        })
      : await providers.email({
          messageId,
          fromName: agency.name,
          replyTo: agency.contactEmail,
          to: target.to,
          subject,
          ...renderEmail(
            emailBrand(agency),
            `Your sign-in code is ${code}\n\nIt expires in 10 minutes. ${agency.name} will never ask you for this code. If you did not try to sign in, you can ignore this email.`,
            null,
          ),
          attachments: [],
        });
  if (sent.provider !== "dev") {
    await withPlatform((tx) =>
      tx.insert(schema.providerMessages).values({ provider: sent.provider, providerId: sent.providerId, agencyId, messageId }).onConflictDoNothing(),
    );
  }
  await withAgency({ agencyId }, async (tx) => {
    await tx.insert(schema.messages).values({
      id: messageId,
      batchId: messageId,
      templateKey: "portal_sign_in_code",
      channel: target.channel,
      recipientKind: "tenant",
      recipientId: target.tenantId,
      recipientName: target.name,
      toAddress: target.to,
      subject: target.channel === "email" ? subject : null,
      body: "Portal sign-in code (not shown)",
      payload: {},
      status: "sent",
      attempts: 1,
      provider: sent.provider,
      providerId: sent.providerId,
      sentAt: sql`now()`,
    });
    await countUsage(tx, target.channel);
  });
}

/** The portal user for a tenant who has just proved their code, created on first sign-in. */
export async function ensurePortalUser(agencyId: string, tenantId: string): Promise<string> {
  return withAgency({ agencyId }, async (tx) => {
    const [t] = await eligible(tx, eq(schema.tenants.id, tenantId));
    if (!t) throw new NotFoundError("Tenant");
    const email = t.email ?? `${tenantId}@portal.invalid`;
    const [user] = await tx
      .insert(schema.portalUsers)
      .values({ tenantId, name: t.name, email, lastLoginAt: sql`now()` })
      .onConflictDoUpdate({
        target: [schema.portalUsers.agencyId, schema.portalUsers.tenantId],
        set: { name: t.name, email, lastLoginAt: sql`now()` },
      })
      .returning();
    if (!user!.active) throw new NotFoundError("Tenant");
    await audit(tx, { action: "portal.signed_in", entity: "tenant", entityId: tenantId });
    return user!.id;
  });
}

/** The portal session's tenant, re-checked on every request: still allowed in? */
export async function portalUser(agencyId: string, portalUserId: string) {
  return withAgency({ agencyId, portalUserId, readOnly: true }, async (tx) => {
    const [row] = await tx
      .select({ user: schema.portalUsers, tenant: schema.tenants })
      .from(schema.portalUsers)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.portalUsers.tenantId))
      .where(and(eq(schema.portalUsers.id, portalUserId), eq(schema.portalUsers.active, true), isNull(schema.tenants.archivedAt)));
    return row ?? null;
  });
}

// ─── What the tenant sees ──────────────────────────────────────────────

async function assertOnLease(tx: Tx, actor: PortalActor, leaseId: string) {
  const [row] = await tx
    .select({ id: schema.leases.id })
    .from(schema.leases)
    .innerJoin(schema.leaseTenants, eq(schema.leaseTenants.leaseId, schema.leases.id))
    .where(and(eq(schema.leases.id, leaseId), eq(schema.leaseTenants.tenantId, actor.tenantId), ne(schema.leases.status, "draft")));
  if (!row) throw new NotFoundError("Lease");
}

const read = (actor: PortalActor) => ({ ...actor.ctx, readOnly: true });

/** The tenant's leases, live ones first, with balances. */
export async function portalLeases(actor: PortalActor, today = todayInSouthAfrica()) {
  return withAgency(read(actor), async (tx) => {
    const leases = await tx
      .select({ lease: schema.leases })
      .from(schema.leases)
      .innerJoin(schema.leaseTenants, eq(schema.leaseTenants.leaseId, schema.leases.id))
      .where(and(eq(schema.leaseTenants.tenantId, actor.tenantId), ne(schema.leases.status, "draft")))
      .orderBy(sql`case when ${schema.leases.status} in ('active', 'notice_given') then 0 else 1 end`, desc(schema.leases.startDate));
    const out = [];
    for (const { lease } of leases) {
      const ledger = await ledgerInTx(tx, lease.id, today);
      out.push({
        id: lease.id,
        eftReference: lease.eftReference,
        status: lease.status,
        unit: await unitName(tx, lease.id),
        startDate: lease.startDate,
        endDate: lease.endDate,
        rentCents: lease.rentCents,
        dueDay: lease.dueDay,
        balanceCents: ledger.balanceCents,
        overdueCents: ledger.overdueCents,
        creditCents: ledger.creditCents,
      });
    }
    return out;
  });
}

export async function portalLedger(actor: PortalActor, leaseId: string) {
  return withAgency(read(actor), async (tx) => {
    await assertOnLease(tx, actor, leaseId);
    return { ...(await ledgerInTx(tx, leaseId)), unit: await unitName(tx, leaseId) };
  });
}

export async function portalReceipts(actor: PortalActor, leaseId: string) {
  return withAgency(read(actor), async (tx) => {
    await assertOnLease(tx, actor, leaseId);
    return tx.select().from(schema.receipts).where(eq(schema.receipts.leaseId, leaseId)).orderBy(desc(schema.receipts.issuedAt));
  });
}

/** A short-lived download link for one of the tenant's receipts (by number, as in /r/{number}). */
export async function portalReceiptUrl(actor: PortalActor, receiptNumber: string): Promise<string> {
  const doc = await withAgency(read(actor), async (tx) => {
    const [r] = await tx
      .select({ leaseId: schema.receipts.leaseId, doc: schema.documents })
      .from(schema.receipts)
      .innerJoin(schema.documents, eq(schema.documents.id, schema.receipts.documentId))
      .where(eq(schema.receipts.receiptNumber, receiptNumber));
    if (!r || r.doc.status !== "clean") throw new NotFoundError("Receipt");
    await assertOnLease(tx, actor, r.leaseId);
    return r.doc;
  });
  return signedDownloadUrl(doc.fileKey, actor.ctx.agencyId, doc.filename);
}

/** The statement PDF; generating it is audited under the portal user. */
export async function portalStatementPdf(actor: PortalActor, leaseId: string) {
  const ledger = await withAgency(read(actor), async (tx) => {
    await assertOnLease(tx, actor, leaseId);
    return ledgerInTx(tx, leaseId);
  });
  return renderStatementPdf(actor.ctx, leaseId, ledger);
}

/** Where and how to pay: the agency's trust account and the tenant's references (D77). */
export async function portalPaymentDetails(actor: PortalActor) {
  const [agency] = await withAgency(read(actor), (tx) =>
    tx
      .select({
        bank: schema.agencies.trustBankName,
        holder: schema.agencies.trustAccountHolder,
        branchCode: schema.agencies.trustBranchCode,
        legalName: schema.agencies.legalName,
        name: schema.agencies.name,
      })
      .from(schema.agencies),
  );
  const accountNumber = await trustAccountNumber(read(actor));
  const leases = await portalLeases(actor);
  return {
    bank: agency!.bank,
    holder: agency!.holder ?? agency!.legalName ?? agency!.name,
    branchCode: agency!.branchCode,
    accountNumber,
    leases: leases.filter((l) => l.status === "active" || l.status === "notice_given" || l.balanceCents > 0),
  };
}

export async function portalPops(actor: PortalActor, leaseId: string) {
  return withAgency(read(actor), async (tx) => {
    await assertOnLease(tx, actor, leaseId);
    return tx
      .select({
        id: schema.proofsOfPayment.id,
        claimedCents: schema.proofsOfPayment.claimedCents,
        claimedPaidOn: schema.proofsOfPayment.claimedPaidOn,
        status: schema.proofsOfPayment.status,
        rejectReason: schema.proofsOfPayment.rejectReason,
        createdAt: schema.proofsOfPayment.createdAt,
      })
      .from(schema.proofsOfPayment)
      .where(eq(schema.proofsOfPayment.leaseId, leaseId))
      .orderBy(desc(schema.proofsOfPayment.createdAt))
      .limit(20);
  });
}

/** A proof of payment from the tenant: virus-scanned and queued for accounts like any other (D58). */
export async function portalSubmitPop(
  actor: PortalActor,
  input: { leaseId: string; filename: string; bytes: Uint8Array; claim: PopClaim },
): Promise<{ popId: string; documentId: string }> {
  const check = (tx: Tx) => assertOnLease(tx, actor, input.leaseId);
  const documentId = await storeUpload(
    actor.ctx,
    { subject: { type: "lease", id: input.leaseId }, kind: "proof_of_payment", filename: input.filename, bytes: input.bytes },
    check,
  );
  return withAgency(actor.ctx, async (tx) => {
    await check(tx);
    return { popId: await recordPop(tx, { leaseId: input.leaseId, tenantId: actor.tenantId, documentId, claim: input.claim, via: "portal" }), documentId };
  });
}

// ─── Message consent (spec: "manage notification consent") ─────────────

export async function portalProfile(actor: PortalActor) {
  const [t] = await withAgency(read(actor), (tx) =>
    tx
      .select({
        fullName: schema.tenants.fullName,
        email: schema.tenants.email,
        phone: schema.tenants.phone,
        emailOptIn: schema.tenants.emailOptIn,
        smsOptIn: schema.tenants.smsOptIn,
      })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, actor.tenantId)),
  );
  if (!t) throw new NotFoundError("Tenant");
  return t;
}

/** The tenant turns email and SMS messages on or off; audited as theirs. */
export async function portalSetConsent(actor: PortalActor, input: { email: boolean; sms: boolean }): Promise<void> {
  await withAgency(actor.ctx, async (tx) => {
    const [before] = await tx
      .select({ emailOptIn: schema.tenants.emailOptIn, smsOptIn: schema.tenants.smsOptIn })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, actor.tenantId))
      .for("update");
    if (!before) throw new NotFoundError("Tenant");
    const after = { emailOptIn: input.email, smsOptIn: input.sms };
    if (before.emailOptIn === after.emailOptIn && before.smsOptIn === after.smsOptIn) return;
    await tx.update(schema.tenants).set(after).where(eq(schema.tenants.id, actor.tenantId));
    await audit(tx, { action: "tenant.consent_changed", entity: "tenant", entityId: actor.tenantId, before, after: { ...after, via: "portal" } });
  });
}
