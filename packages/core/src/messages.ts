import { randomInt, randomUUID } from "node:crypto";
import { schema, type Tx, withAgency, withPlatform } from "@awdrent/db";
import { and, asc, desc, eq, ilike, inArray, ne, or, type SQL, sql } from "drizzle-orm";
import { audit } from "./audit";
import { agencyOrigin } from "./hosts";
import { allowedVariables, CATALOGUE_KEYS, type CatalogueEntry, catalogueEntry, SAMPLE_VALUES } from "./messaging/catalogue";
import { defaultProviders, PermanentSendError, type Providers } from "./messaging/providers";
import {
  type EmailBrand,
  firstName,
  fitSms,
  gsmLength,
  outsideQuietHours,
  renderEmail,
  renderText,
  SMS_LIMIT,
  toMsisdn,
  unknownVariables,
} from "./messaging/render";
import { advancesStatus, type DeliveryStatus } from "./messaging/webhooks";
import { type Actor, authorise, leaseScope, NotFoundError } from "./portfolio";
import { readObject } from "./storage";

// The messaging service (spec "Notifications"; D64–D71).
//
//   send()          renders a catalogue message for each of its channels the
//                   recipient has opted in to, and logs one row per channel
//                   (suppressed, with the reason, if it cannot go). Runs in
//                   the caller's transaction, so a message exists only if the
//                   event that caused it committed.
//   deliverDue()    worker step: sends due rows, 3 attempts with backoff,
//                   waiting out quiet hours; a failed SMS falls back to email.
//   recordDelivery  webhook step: delivery reports update the log.

export type SendChannel = "email" | "sms";
const LIVE_CHANNELS: readonly SendChannel[] = ["email", "sms"];
export const MAX_ATTEMPTS = 3;
// Wait after the 1st and 2nd failed attempt
const BACKOFF_MS = [60_000, 5 * 60_000];

export interface TenantRecipient {
  kind: "tenant";
  tenantId: string;
}

type Message = typeof schema.messages.$inferSelect;
type Agency = typeof schema.agencies.$inferSelect;

async function ownAgency(tx: Tx): Promise<Agency> {
  const [agency] = await tx.select().from(schema.agencies);
  if (!agency) throw new Error("no agency in context");
  return agency;
}

async function overrides(tx: Tx, key: string) {
  const rows = await tx.select().from(schema.messageTemplates).where(eq(schema.messageTemplates.key, key));
  return new Map(rows.map((r) => [r.channel, r]));
}

const OPT_OUT_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** The tenant's short opt-out code, created the first time it is needed. */
async function optOutCode(tx: Tx, tenant: typeof schema.tenants.$inferSelect): Promise<string> {
  if (tenant.optOutCode) return tenant.optOutCode;
  for (let attempt = 0; ; attempt++) {
    const code = Array.from({ length: 7 }, () => OPT_OUT_ALPHABET[randomInt(OPT_OUT_ALPHABET.length)]).join("");
    try {
      await tx.execute(sql`savepoint opt_out_code`);
      await tx.update(schema.tenants).set({ optOutCode: code }).where(eq(schema.tenants.id, tenant.id));
      await tx.execute(sql`release savepoint opt_out_code`);
      return code;
    } catch (err) {
      await tx.execute(sql`rollback to savepoint opt_out_code`);
      if (attempt >= 3) throw err;
    }
  }
}

/** Links in SMS go without "https://" to save characters; phones still recognise them. */
const smsValues = (vars: Record<string, string>) => Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, v.replace(/^https:\/\//, "")]));

function rendered(
  channel: SendChannel,
  entry: CatalogueEntry,
  override: { subject: string | null; body: string } | undefined,
  vars: Record<string, string>,
): { subject: string | null; body: string } {
  if (channel === "sms") {
    const template = override?.body ?? entry.sms ?? entry.email;
    const values = smsValues(vars);
    const suffix = values.opt_out_link ? ` Opt out: ${values.opt_out_link}` : null;
    return { subject: null, body: fitSms(template, values, suffix).text };
  }
  return {
    subject: renderText(override?.subject ?? entry.emailSubject, vars).replace(/[\r\n]+/g, " ").slice(0, 200),
    body: renderText(override?.body ?? entry.email, vars),
  };
}

function address(channel: SendChannel, tenant: typeof schema.tenants.$inferSelect): { to: string; reason: string | null } {
  if (channel === "email") {
    if (!tenant.email) return { to: "", reason: "No email address" };
    if (!tenant.emailOptIn) return { to: tenant.email, reason: "Not opted in to email" };
    return { to: tenant.email, reason: null };
  }
  const msisdn = toMsisdn(tenant.phone);
  if (!tenant.phone) return { to: "", reason: "No phone number" };
  if (!msisdn) return { to: tenant.phone, reason: "Phone number cannot receive SMS" };
  if (!tenant.smsOptIn) return { to: msisdn, reason: "Not opted in to SMS" };
  return { to: msisdn, reason: null };
}

/**
 * Queues a catalogue message to a tenant on each channel the message uses
 * (spec: send(recipient, template_key, variables)). Call inside the
 * transaction of the event it reports. Returns the batch id.
 */
export async function send(
  tx: Tx,
  input: {
    recipient: TenantRecipient;
    templateKey: string;
    variables: Record<string, string>;
    leaseId?: string | null;
    attachmentDocumentId?: string | null;
    now?: Date;
  },
): Promise<string> {
  const entry = catalogueEntry(input.templateKey);
  const agency = await ownAgency(tx);
  const [tenant] = await tx.select().from(schema.tenants).where(eq(schema.tenants.id, input.recipient.tenantId));
  if (!tenant) throw new NotFoundError("Tenant");
  const code = await optOutCode(tx, tenant);
  const vars: Record<string, string> = {
    name: firstName(tenant.fullName),
    agency: agency.name,
    ...input.variables,
    opt_out_link: `${agencyOrigin(agency.subdomain)}/o/${code}`,
  };
  const custom = await overrides(tx, entry.key);
  const batchId = randomUUID();
  const notBefore = outsideQuietHours(input.now ?? new Date(), agency.quietHoursStart, agency.quietHoursEnd);
  for (const channel of entry.channels.filter((c): c is SendChannel => LIVE_CHANNELS.includes(c as SendChannel))) {
    const { to, reason } = address(channel, tenant);
    const { subject, body } = rendered(channel, entry, custom.get(channel), vars);
    await tx.insert(schema.messages).values({
      batchId,
      templateKey: entry.key,
      channel,
      recipientKind: "tenant",
      recipientId: tenant.id,
      recipientName: tenant.fullName,
      toAddress: to,
      leaseId: input.leaseId ?? null,
      subject,
      body,
      payload: vars,
      attachmentDocumentId: channel === "email" ? (input.attachmentDocumentId ?? null) : null,
      status: reason ? "suppressed" : "queued",
      error: reason,
      nextAttemptAt: notBefore,
    });
  }
  return batchId;
}

/**
 * The spec's fallback rule: when an SMS fails, email the same message,
 * unless the recipient already gets this one by email or cannot.
 */
async function fallbackToEmail(tx: Tx, failed: Message): Promise<string | null> {
  if (failed.channel === "email" || failed.recipientKind !== "tenant" || !failed.recipientId) return null;
  const [already] = await tx
    .select({ id: schema.messages.id })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.batchId, failed.batchId),
        eq(schema.messages.recipientId, failed.recipientId),
        eq(schema.messages.channel, "email"),
        ne(schema.messages.status, "suppressed"),
      ),
    );
  if (already) return null;
  const [tenant] = await tx.select().from(schema.tenants).where(eq(schema.tenants.id, failed.recipientId));
  if (!tenant?.email || !tenant.emailOptIn) return null;
  const agency = await ownAgency(tx);
  const entry = catalogueEntry(failed.templateKey);
  const { subject, body } = rendered("email", entry, (await overrides(tx, entry.key)).get("email"), failed.payload);
  const [row] = await tx
    .insert(schema.messages)
    .values({
      batchId: failed.batchId,
      templateKey: failed.templateKey,
      channel: "email",
      recipientKind: "tenant",
      recipientId: tenant.id,
      recipientName: tenant.fullName,
      toAddress: tenant.email,
      leaseId: failed.leaseId,
      subject,
      body,
      payload: failed.payload,
      attachmentDocumentId: failed.attachmentDocumentId,
      nextAttemptAt: outsideQuietHours(new Date(), agency.quietHoursStart, agency.quietHoursEnd),
      fallbackOf: failed.id,
    })
    .returning({ id: schema.messages.id });
  return row!.id;
}

function emailBrand(agency: Agency): EmailBrand {
  const lines = [
    agency.legalName ?? agency.name,
    [agency.registrationNo ? `Reg. no. ${agency.registrationNo}` : null, agency.ffcNumber ? `FFC ${agency.ffcNumber}` : null, agency.vatNumber ? `VAT no. ${agency.vatNumber}` : null]
      .filter(Boolean)
      .join(" · "),
    agency.physicalAddress?.replace(/\s*\n\s*/g, ", ") ?? "",
    [agency.contactPhone, agency.contactEmail].filter(Boolean).join(" · "),
  ];
  return {
    agencyName: agency.name,
    colour: agency.brandColour,
    logoUrl: agency.logoKey ? `${agencyOrigin(agency.subdomain)}/branding/logo` : null,
    footer: lines.filter((l) => l.length > 0),
  };
}

/** Claims due messages for this worker run, so two workers never send the same one. */
async function claimDue(agencyId: string, limit: number): Promise<Message[]> {
  return withAgency({ agencyId }, async (tx) => {
    const due = tx
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.status, "queued"),
          sql`${schema.messages.nextAttemptAt} <= now()`,
          sql`(${schema.messages.lockedUntil} is null or ${schema.messages.lockedUntil} < now())`,
        ),
      )
      .orderBy(asc(schema.messages.nextAttemptAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    return tx
      .update(schema.messages)
      .set({ lockedUntil: sql`now() + interval '5 minutes'` })
      .where(inArray(schema.messages.id, due))
      .returning();
  });
}

async function countUsage(tx: Tx, channel: string): Promise<void> {
  const month = sql`date_trunc('month', now() at time zone 'Africa/Johannesburg')::date`;
  const column = channel === "sms" ? "smsSent" : channel === "whatsapp" ? "whatsappSent" : "emailsSent";
  await tx
    .insert(schema.usageCounters)
    .values({ month, [column]: 1 })
    .onConflictDoUpdate({
      target: [schema.usageCounters.agencyId, schema.usageCounters.month],
      set: { [column]: sql`${schema.usageCounters[column]} + 1` },
    });
}

/**
 * Worker step for one agency: sends the messages that are due. Failures are
 * retried after 1 and then 5 minutes (outside quiet hours); after the third
 * failed attempt the message is marked failed and an SMS falls back to email.
 */
export async function deliverDue(
  agencyId: string,
  opts: { providers?: Providers; limit?: number } = {},
): Promise<{ sent: number; failed: number; retrying: number }> {
  const providers = opts.providers ?? defaultProviders();
  const claimed = await claimDue(agencyId, opts.limit ?? 50);
  const result = { sent: 0, failed: 0, retrying: 0 };
  if (claimed.length === 0) return result;
  const agency = await withAgency({ agencyId, readOnly: true }, ownAgency);
  for (const m of claimed) {
    try {
      let sent;
      if (m.channel === "sms") {
        sent = await providers.sms({ messageId: m.id, from: agency.smsSenderName, to: m.toAddress, text: m.body });
      } else if (m.channel === "email") {
        const attachments: { filename: string; content: Uint8Array }[] = [];
        if (m.attachmentDocumentId) {
          const [doc] = await withAgency({ agencyId, readOnly: true }, (tx) =>
            tx.select().from(schema.documents).where(eq(schema.documents.id, m.attachmentDocumentId!)),
          );
          if (doc?.status !== "clean") throw new Error("The attachment is not available");
          attachments.push({ filename: doc.filename, content: await readObject(doc.fileKey) });
        }
        const { html, text } = renderEmail(emailBrand(agency), m.body, m.payload.opt_out_link ?? null);
        sent = await providers.email({
          messageId: m.id,
          fromName: agency.name,
          replyTo: agency.contactEmail,
          to: m.toAddress,
          subject: m.subject ?? "",
          html,
          text,
          attachments,
        });
      } else {
        throw new PermanentSendError(`The ${m.channel} channel is not switched on`);
      }
      // Record the provider's id first, so an early delivery report can find the message
      if (sent.provider !== "dev") {
        await withPlatform((tx) =>
          tx.insert(schema.providerMessages).values({ provider: sent.provider, providerId: sent.providerId, agencyId, messageId: m.id }).onConflictDoNothing(),
        );
      }
      await withAgency({ agencyId }, async (tx) => {
        await tx
          .update(schema.messages)
          .set({ status: "sent", provider: sent.provider, providerId: sent.providerId, sentAt: sql`now()`, attempts: m.attempts + 1, lockedUntil: null, error: null })
          .where(eq(schema.messages.id, m.id));
        await countUsage(tx, m.channel);
      });
      result.sent++;
    } catch (err) {
      const attempts = m.attempts + 1;
      const error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      const final = err instanceof PermanentSendError || attempts >= MAX_ATTEMPTS;
      await withAgency({ agencyId }, async (tx) => {
        if (final) {
          await tx.update(schema.messages).set({ status: "failed", attempts, error, lockedUntil: null }).where(eq(schema.messages.id, m.id));
          await fallbackToEmail(tx, { ...m, status: "failed" });
        } else {
          const retryAt = outsideQuietHours(new Date(Date.now() + BACKOFF_MS[attempts - 1]!), agency.quietHoursStart, agency.quietHoursEnd);
          await tx.update(schema.messages).set({ attempts, error, nextAttemptAt: retryAt, lockedUntil: null }).where(eq(schema.messages.id, m.id));
        }
      });
      if (final) result.failed++;
      else result.retrying++;
    }
  }
  return result;
}

/**
 * Applies a verified delivery report. Reports for unknown ids are ignored;
 * reports that would move a message backwards (they arrive out of order) too.
 */
export async function recordDelivery(
  provider: string,
  providerId: string,
  status: DeliveryStatus,
  detail?: string | null,
): Promise<"updated" | "ignored" | "unknown"> {
  const [route] = await withPlatform((tx) =>
    tx
      .select()
      .from(schema.providerMessages)
      .where(and(eq(schema.providerMessages.provider, provider), eq(schema.providerMessages.providerId, providerId))),
  );
  if (!route) return "unknown";
  return withAgency({ agencyId: route.agencyId }, async (tx) => {
    const [m] = await tx.select().from(schema.messages).where(eq(schema.messages.id, route.messageId)).for("update");
    if (!m || !advancesStatus(m.status, status)) return "ignored";
    await tx
      .update(schema.messages)
      .set({
        status,
        ...(status === "delivered" || status === "read" ? { deliveredAt: m.deliveredAt ?? sql`now()` } : {}),
        ...(status === "failed" ? { error: (detail ?? "Not delivered").slice(0, 500) } : {}),
      })
      .where(eq(schema.messages.id, m.id));
    if (status === "failed") await fallbackToEmail(tx, { ...m, status: "failed" });
    return "updated";
  });
}

// ─── The notification log ──────────────────────────────────────────────

export async function listMessages(
  actor: Actor,
  filters: { status?: string; channel?: string; leaseId?: string; q?: string; limit?: number } = {},
) {
  authorise(actor, "messages.view");
  return withAgency({ ...actor.ctx, readOnly: true }, async (tx) => {
    const where: (SQL | undefined)[] = [];
    const scope = leaseScope(actor);
    // Agents see messages about leases in their portfolio
    if (scope) where.push(inArray(schema.messages.leaseId, tx.select({ id: schema.leases.id }).from(schema.leases).where(scope)));
    if (filters.status) where.push(eq(schema.messages.status, filters.status as Message["status"]));
    if (filters.channel) where.push(eq(schema.messages.channel, filters.channel as Message["channel"]));
    if (filters.leaseId) where.push(eq(schema.messages.leaseId, filters.leaseId));
    if (filters.q) {
      const like = `%${filters.q.replace(/[%_\\]/g, "\\$&")}%`;
      where.push(or(ilike(schema.messages.recipientName, like), ilike(schema.messages.toAddress, like), ilike(schema.messages.templateKey, like)));
    }
    return tx
      .select({
        id: schema.messages.id,
        createdAt: schema.messages.createdAt,
        templateKey: schema.messages.templateKey,
        channel: schema.messages.channel,
        recipientName: schema.messages.recipientName,
        toAddress: schema.messages.toAddress,
        leaseId: schema.messages.leaseId,
        subject: schema.messages.subject,
        body: schema.messages.body,
        status: schema.messages.status,
        attempts: schema.messages.attempts,
        nextAttemptAt: schema.messages.nextAttemptAt,
        error: schema.messages.error,
        sentAt: schema.messages.sentAt,
        deliveredAt: schema.messages.deliveredAt,
        fallbackOf: schema.messages.fallbackOf,
        hasAttachment: sql<boolean>`${schema.messages.attachmentDocumentId} is not null`,
      })
      .from(schema.messages)
      .where(and(...where))
      .orderBy(desc(schema.messages.createdAt))
      .limit(Math.min(filters.limit ?? 200, 500));
  });
}

// ─── Wording (agency settings) ─────────────────────────────────────────

export interface TemplateView {
  entry: CatalogueEntry;
  email: { subject: string; body: string; custom: boolean };
  sms: { body: string; custom: boolean; sampleLength: number } | null;
}

export async function listTemplates(actor: Actor): Promise<TemplateView[]> {
  authorise(actor, "settings.manage");
  const rows = await withAgency({ ...actor.ctx, readOnly: true }, (tx) => tx.select().from(schema.messageTemplates));
  const custom = (key: string, channel: string) => rows.find((r) => r.key === key && r.channel === channel);
  return CATALOGUE_KEYS.map((key) => {
    const entry = catalogueEntry(key);
    const email = custom(key, "email");
    const sms = custom(key, "sms");
    const smsBody = sms?.body ?? entry.sms;
    return {
      entry,
      email: { subject: email?.subject ?? entry.emailSubject, body: email?.body ?? entry.email, custom: !!email },
      sms:
        smsBody === null || !(entry.channels.includes("sms") || sms)
          ? null
          : { body: smsBody, custom: !!sms, sampleLength: gsmLength(fitSms(smsBody, SAMPLE_VALUES, null).text) },
    };
  });
}

/** Problems with edited wording, as messages for the form. */
export function checkWording(key: string, channel: SendChannel, subject: string | null, body: string): string[] {
  const entry = catalogueEntry(key);
  const allowed = allowedVariables(entry);
  const problems: string[] = [];
  if (!body.trim()) problems.push("The message cannot be empty.");
  const unknown = unknownVariables(`${subject ?? ""} ${body}`, allowed);
  if (unknown.length) problems.push(`Unknown ${unknown.length === 1 ? "variable" : "variables"}: ${unknown.map((u) => `{${u}}`).join(", ")}. You can use ${allowed.map((a) => `{${a}}`).join(", ")}.`);
  if (channel === "email") {
    if (!subject?.trim()) problems.push("The email needs a subject.");
    if (body.length > 4000) problems.push("Keep the email under 4 000 characters.");
  } else {
    // Long values are shortened at send time, but wording that cannot fit even with typical values would cost two SMS each time
    const length = gsmLength(fitSms(body, SAMPLE_VALUES, null).text);
    if (length > SMS_LIMIT) problems.push(`With typical details this SMS is about ${length} characters; one SMS holds ${SMS_LIMIT}.`);
  }
  return problems;
}

export class WordingError extends Error {
  constructor(public problems: string[]) {
    super(problems.join(" "));
    this.name = "WordingError";
  }
}

export async function saveWording(actor: Actor, input: { key: string; channel: SendChannel; subject: string | null; body: string }): Promise<void> {
  authorise(actor, "settings.manage");
  const problems = checkWording(input.key, input.channel, input.subject, input.body);
  if (problems.length) throw new WordingError(problems);
  const subject = input.channel === "email" ? input.subject!.trim() : null;
  const body = input.body.replace(/\r\n/g, "\n").trim();
  await withAgency(actor.ctx, async (tx) => {
    const [before] = await tx
      .select()
      .from(schema.messageTemplates)
      .where(and(eq(schema.messageTemplates.key, input.key), eq(schema.messageTemplates.channel, input.channel)));
    await tx
      .insert(schema.messageTemplates)
      .values({ key: input.key, channel: input.channel, subject, body })
      .onConflictDoUpdate({
        target: [schema.messageTemplates.agencyId, schema.messageTemplates.key, schema.messageTemplates.channel],
        set: { subject, body },
      });
    await audit(tx, {
      action: "message_template.saved",
      entity: "message_template",
      before: before ? { key: input.key, channel: input.channel, subject: before.subject, body: before.body } : null,
      after: { key: input.key, channel: input.channel, subject, body },
    });
  });
}

/** Back to the built-in wording. */
export async function resetWording(actor: Actor, key: string, channel: SendChannel): Promise<void> {
  authorise(actor, "settings.manage");
  catalogueEntry(key);
  await withAgency(actor.ctx, async (tx) => {
    const deleted = await tx
      .delete(schema.messageTemplates)
      .where(and(eq(schema.messageTemplates.key, key), eq(schema.messageTemplates.channel, channel)))
      .returning();
    if (deleted.length) {
      await audit(tx, { action: "message_template.reset", entity: "message_template", before: { key, channel, subject: deleted[0]!.subject, body: deleted[0]!.body } });
    }
  });
}

// ─── Opt-out links (D39, D68) ──────────────────────────────────────────
// The agency comes from the host the link was opened on, never from the
// link itself; the code only finds a tenant within that agency.

const CODE_RE = /^[A-Za-z0-9]{6,12}$/;

export async function optOutStatus(agencyId: string, code: string): Promise<{ sms: boolean; email: boolean } | null> {
  if (!CODE_RE.test(code)) return null;
  const [t] = await withAgency({ agencyId, readOnly: true }, (tx) =>
    tx.select({ sms: schema.tenants.smsOptIn, email: schema.tenants.emailOptIn }).from(schema.tenants).where(eq(schema.tenants.optOutCode, code)),
  );
  return t ?? null;
}

export async function optOut(agencyId: string, code: string, channels: SendChannel[]): Promise<boolean> {
  if (!CODE_RE.test(code) || channels.length === 0) return false;
  return withAgency({ agencyId }, async (tx) => {
    const [t] = await tx.select().from(schema.tenants).where(eq(schema.tenants.optOutCode, code)).for("update");
    if (!t) return false;
    const change = { ...(channels.includes("sms") ? { smsOptIn: false } : {}), ...(channels.includes("email") ? { emailOptIn: false } : {}) };
    await tx.update(schema.tenants).set(change).where(eq(schema.tenants.id, t.id));
    await audit(tx, {
      action: "tenant.opted_out",
      entity: "tenant",
      entityId: t.id,
      before: { smsOptIn: t.smsOptIn, emailOptIn: t.emailOptIn },
      after: { ...change, via: "opt-out link" },
    });
    return true;
  });
}

// ─── Helpers for the events that send messages ─────────────────────────

/** A full link on the agency's own host, e.g. for {link}. */
export async function agencyUrl(tx: Tx, path: string): Promise<string> {
  return `${agencyOrigin((await ownAgency(tx)).subdomain)}${path}`;
}

/** The lease's primary tenant (lease messages go to them; D65). */
export async function primaryTenantId(tx: Tx, leaseId: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: schema.leaseTenants.tenantId })
    .from(schema.leaseTenants)
    .where(and(eq(schema.leaseTenants.leaseId, leaseId), eq(schema.leaseTenants.isPrimary, true)));
  return row?.id ?? null;
}

/** "Flat 4, Sunset Court" */
export async function unitName(tx: Tx, leaseId: string): Promise<string> {
  const [row] = await tx
    .select({ unit: schema.units.label, property: schema.properties.name })
    .from(schema.leases)
    .innerJoin(schema.units, eq(schema.units.id, schema.leases.unitId))
    .innerJoin(schema.properties, eq(schema.properties.id, schema.units.propertyId))
    .where(eq(schema.leases.id, leaseId));
  return row ? `${row.unit}, ${row.property}` : "";
}

/**
 * Who the tenant should contact: the agent whose portfolio holds the
 * property, else the agency itself (D66).
 */
export async function leaseContact(tx: Tx, leaseId: string): Promise<{ agent_name: string; agent_phone: string }> {
  const agency = await ownAgency(tx);
  const [agent] = await tx
    .select({ name: schema.users.name, phone: schema.users.phone })
    .from(schema.leases)
    .innerJoin(schema.units, eq(schema.units.id, schema.leases.unitId))
    .innerJoin(schema.agentPortfolios, eq(schema.agentPortfolios.propertyId, schema.units.propertyId))
    .innerJoin(schema.users, eq(schema.users.id, schema.agentPortfolios.userId))
    .where(and(eq(schema.leases.id, leaseId), eq(schema.users.active, true)))
    .orderBy(asc(schema.agentPortfolios.createdAt))
    .limit(1);
  const agencyPhone = agency.contactPhone ?? agency.contactEmail ?? "our office";
  if (agent?.phone) return { agent_name: agent.name, agent_phone: agent.phone };
  return { agent_name: agent?.name ?? agency.name, agent_phone: agencyPhone };
}
