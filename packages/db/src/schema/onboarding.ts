import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, integer, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agencyColumn, createdBy, pk, timestamps, tstz } from "./_columns";
import { agencies } from "./agencies";
import { leases, tenants, tenantIdKind } from "./leases";
import { units } from "./records";

// Tenant onboarding (spec "Tenant onboarding", 8; D107–D113). An agent invites
// an applicant to a unit; the applicant opens a personal link, consents,
// fills in their details and uploads the documents on the agency's checklist;
// the agent reviews each document; approving creates the tenant and a draft
// lease. Personal information of applications that do not become tenancies
// is deleted after the agency's retention period.

export const applicantType = pgEnum("applicant_type", ["employed", "self_employed", "company"]);
export const applicationStatus = pgEnum("application_status", ["invited", "in_progress", "submitted", "approved", "declined", "revoked", "expired"]);
export const applicationFileStatus = pgEnum("application_file_status", ["pending", "accepted", "rejected"]);

/** An agency's own checklist for an applicant type; the built-in one applies otherwise. */
export const applicationChecklists = pgTable(
  "application_checklists",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    applicantType: applicantType().notNull(),
    // [{ key, label, required }]
    items: jsonb().$type<{ key: string; label: string; required: boolean }[]>().notNull(),
    ...timestamps,
    createdBy: createdBy(),
  },
  (t) => [uniqueIndex("application_checklists_agency_type_key").on(t.agencyId, t.applicantType)],
);

export const applications = pgTable(
  "applications",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    unitId: uuid().notNull(),
    applicantType: applicantType().notNull(),
    // The checklist as it was when the applicant was invited
    checklist: jsonb().$type<{ key: string; label: string; required: boolean }[]>().notNull(),
    fullName: text().notNull(),
    email: text(),
    phone: text(),
    status: applicationStatus().notNull().default("invited"),
    // SHA-256 of the personal link token; the token is only in the invitation
    tokenHash: text().notNull(),
    // The token itself, encrypted, so later messages can repeat the same link (D109)
    tokenEnc: text().notNull(),
    expiresAt: tstz().notNull(),
    consentAt: tstz(),
    idKind: tenantIdKind(),
    idNumberEnc: text(),
    idNumberLast4: text(),
    idNumberBlindIndex: text(),
    employer: text(),
    currentAddress: text(),
    // What the agent proposes; becomes the draft lease
    proposedRentCents: integer().notNull(),
    proposedStart: date().notNull(),
    submittedAt: tstz(),
    remindedAt: tstz(),
    decidedAt: tstz(),
    decidedBy: uuid(),
    declineReason: text(),
    tenantId: uuid(),
    leaseId: uuid(),
    // When the applicant's documents and personal details were deleted (D112)
    purgedAt: tstz(),
    ...timestamps,
    createdBy: createdBy(),
  },
  (t) => [
    uniqueIndex("applications_agency_id_id_key").on(t.agencyId, t.id),
    uniqueIndex("applications_agency_token_key").on(t.agencyId, t.tokenHash),
    index("applications_agency_status_idx").on(t.agencyId, t.status, t.createdAt),
    foreignKey({ name: "applications_unit_fk", columns: [t.agencyId, t.unitId], foreignColumns: [units.agencyId, units.id] }),
    foreignKey({ name: "applications_tenant_fk", columns: [t.agencyId, t.tenantId], foreignColumns: [tenants.agencyId, tenants.id] }),
    foreignKey({ name: "applications_lease_fk", columns: [t.agencyId, t.leaseId], foreignColumns: [leases.agencyId, leases.id] }),
    check("applications_rent_positive", sql`${t.proposedRentCents} > 0`),
    check("applications_contact", sql`${t.email} is not null or ${t.phone} is not null or ${t.purgedAt} is not null`),
  ],
);

/** A file the applicant uploaded for a checklist item, and its review. */
export const applicationFiles = pgTable(
  "application_files",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    applicationId: uuid().notNull(),
    itemKey: text().notNull(),
    documentId: uuid().notNull(),
    status: applicationFileStatus().notNull().default("pending"),
    rejectReason: text(),
    reviewedAt: tstz(),
    reviewedBy: uuid(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("application_files_agency_document_key").on(t.agencyId, t.documentId),
    index("application_files_agency_application_idx").on(t.agencyId, t.applicationId),
    foreignKey({ name: "application_files_application_fk", columns: [t.agencyId, t.applicationId], foreignColumns: [applications.agencyId, applications.id] }),
    check("application_files_rejected_reason", sql`(${t.status} = 'rejected') = (${t.rejectReason} is not null)`),
  ],
);
