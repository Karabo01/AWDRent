import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agencyColumn, pk, timestamps, tstz } from "./_columns";
import { agencies } from "./agencies";
import { leases, tenants } from "./leases";

// The POP inbox (spec; D37, D87–D90). Emails forwarded to
// pop+{subdomain}@awdrent.co.za are read by the worker; each becomes one row
// here, with its PDF and image attachments stored as documents of the email.
// An email naming one lease and one amount becomes a proof of payment at
// once; the rest wait here for accounts to complete or dismiss.

export const inboundEmailStatus = pgEnum("inbound_email_status", ["new", "converted", "dismissed"]);

export const inboundEmails = pgTable(
  "inbound_emails",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    // The email's Message-ID, so an email read twice is recorded once
    messageId: text().notNull(),
    fromAddress: text().notNull(),
    fromName: text(),
    subject: text().notNull(),
    receivedAt: tstz().notNull(),
    // The start of the text, for whoever reviews it
    excerpt: text().notNull(),
    status: inboundEmailStatus().notNull().default("new"),
    // What the email seemed to say (D88); accounts confirm or change it
    suggestedLeaseId: uuid(),
    suggestedTenantId: uuid(),
    matchReason: text(),
    suggestedCents: integer(),
    // The proof of payment it became
    popId: uuid(),
    note: text(),
    resolvedAt: tstz(),
    resolvedBy: uuid(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("inbound_emails_agency_id_id_key").on(t.agencyId, t.id),
    uniqueIndex("inbound_emails_agency_message_key").on(t.agencyId, t.messageId),
    index("inbound_emails_agency_status_idx").on(t.agencyId, t.status, t.receivedAt),
    foreignKey({ name: "inbound_emails_lease_fk", columns: [t.agencyId, t.suggestedLeaseId], foreignColumns: [leases.agencyId, leases.id] }),
    foreignKey({ name: "inbound_emails_tenant_fk", columns: [t.agencyId, t.suggestedTenantId], foreignColumns: [tenants.agencyId, tenants.id] }),
    check("inbound_emails_resolved", sql`(${t.status} = 'new') = (${t.resolvedAt} is null)`),
    check("inbound_emails_dismissed_note", sql`${t.status} <> 'dismissed' or ${t.note} is not null`),
  ],
);
