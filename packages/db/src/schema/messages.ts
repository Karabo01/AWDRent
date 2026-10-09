import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agencyColumn, createdBy, pk, timestamps, tstz } from "./_columns";
import { agencies } from "./agencies";
import { documents } from "./documents";
import { leases } from "./leases";

// Messaging (spec "Notifications"; D64–D71). One send() service renders a
// catalogue template per channel and logs one row per channel here; the
// worker delivers queued rows. The table is the notification log: a row's
// recipient and text never change, only its delivery state.

export const messageChannel = pgEnum("message_channel", ["email", "sms", "whatsapp"]);
export const messageStatus = pgEnum("message_status", ["queued", "sent", "delivered", "read", "failed", "suppressed"]);

/** An agency's own wording for a catalogue message; the built-in wording applies otherwise. */
export const messageTemplates = pgTable(
  "message_templates",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    key: text().notNull(),
    channel: messageChannel().notNull(),
    // Email only
    subject: text(),
    body: text().notNull(),
    // WhatsApp (phase 4): the approved Twilio template
    providerTemplateId: text(),
    ...timestamps,
    createdBy: createdBy(),
  },
  (t) => [uniqueIndex("message_templates_agency_key_channel_key").on(t.agencyId, t.key, t.channel)],
);

export const messages = pgTable(
  "messages",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    // The rows created by one send() call share a batch
    batchId: uuid().notNull(),
    templateKey: text().notNull(),
    channel: messageChannel().notNull(),
    recipientKind: text().notNull(),
    recipientId: uuid(),
    recipientName: text().notNull(),
    // Email address or phone number; empty when suppressed for want of one
    toAddress: text().notNull(),
    leaseId: uuid(),
    subject: text(),
    body: text().notNull(),
    payload: jsonb().$type<Record<string, string>>().notNull(),
    attachmentDocumentId: uuid(),
    status: messageStatus().notNull().default("queued"),
    attempts: integer().notNull().default(0),
    // Not before this time: quiet hours and retry backoff
    nextAttemptAt: tstz().notNull().defaultNow(),
    // Claimed by a worker until then
    lockedUntil: tstz(),
    provider: text(),
    providerId: text(),
    error: text(),
    sentAt: tstz(),
    deliveredAt: tstz(),
    // The failed SMS this email replaces (spec fallback rule)
    fallbackOf: uuid(),
    ...timestamps,
    createdBy: createdBy(),
  },
  (t) => [
    uniqueIndex("messages_agency_id_id_key").on(t.agencyId, t.id),
    index("messages_agency_due_idx").on(t.agencyId, t.nextAttemptAt).where(sql`${t.status} = 'queued'`),
    index("messages_agency_created_idx").on(t.agencyId, t.createdAt),
    index("messages_agency_lease_idx").on(t.agencyId, t.leaseId),
    index("messages_agency_batch_idx").on(t.agencyId, t.batchId),
    check("messages_recipient_kind", sql`${t.recipientKind} IN ('tenant', 'owner', 'staff', 'applicant', 'contractor')`),
    foreignKey({ name: "messages_lease_fk", columns: [t.agencyId, t.leaseId], foreignColumns: [leases.agencyId, leases.id] }),
    foreignKey({
      name: "messages_attachment_fk",
      columns: [t.agencyId, t.attachmentDocumentId],
      foreignColumns: [documents.agencyId, documents.id],
    }),
    foreignKey({ name: "messages_fallback_fk", columns: [t.agencyId, t.fallbackOf], foreignColumns: [t.agencyId, t.id] }),
  ],
);

/**
 * Scheduled notices already sent (reminders, overdue, expiry, escalation),
 * one row per lease and notice, so the daily run can repeat safely (D72).
 * e.g. "rent_due_reminder:2026-11-01", "overdue_7:{charge id}".
 */
export const scheduledNotices = pgTable(
  "scheduled_notices",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    leaseId: uuid().notNull(),
    noticeKey: text().notNull(),
    sentOn: date().notNull(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("scheduled_notices_agency_lease_key").on(t.agencyId, t.leaseId, t.noticeKey),
    foreignKey({ name: "scheduled_notices_lease_fk", columns: [t.agencyId, t.leaseId], foreignColumns: [leases.agencyId, leases.id] }),
  ],
);

/**
 * Which agency a provider's message id belongs to, so a delivery webhook can
 * find its message without reading across agencies. Platform role only.
 */
export const providerMessages = pgTable(
  "provider_messages",
  {
    provider: text().notNull(),
    providerId: text().notNull(),
    agencyId: uuid()
      .notNull()
      .references(() => agencies.id),
    messageId: uuid().notNull(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: "provider_messages_pkey", columns: [t.provider, t.providerId] })],
);
