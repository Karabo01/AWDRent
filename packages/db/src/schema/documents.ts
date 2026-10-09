import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgEnum, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { agencyColumn, createdBy, pk, timestamps, tstz } from "./_columns";
import { agencies } from "./agencies";
import { leases, tenants } from "./leases";
import { owners, properties, units } from "./records";

export const documentKind = pgEnum("document_kind", [
  "title_deed",
  "inspection_report",
  "photo",
  "id_document",
  "lease_agreement",
  "proof_of_address",
  "payslip",
  "bank_statement",
  "proof_of_payment",
  "receipt",
  "confirmation_letter",
  "other",
]);

export const documentStatus = pgEnum("document_status", ["pending_scan", "clean", "infected", "scan_failed"]);

/**
 * Uploaded files. Instead of the spec's polymorphic owner_type/owner_id, a
 * document has one nullable column per thing it can belong to, with a check
 * that exactly one is set, so every link is a real composite foreign key and
 * cannot cross agencies (decision D22).
 */
export const documents = pgTable(
  "documents",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    ownerId: uuid(),
    propertyId: uuid(),
    unitId: uuid(),
    tenantId: uuid(),
    leaseId: uuid(),
    kind: documentKind().notNull(),
    // Original name, cleaned for display and download
    filename: text().notNull(),
    // From the file's own bytes, not the browser's claim
    contentType: text().notNull(),
    sizeBytes: integer().notNull(),
    sha256: text().notNull(),
    // agencies/{agency_id}/quarantine|files/{uuid}.{ext}
    fileKey: text().notNull(),
    status: documentStatus().notNull().default("pending_scan"),
    scanResult: text(),
    scannedAt: tstz(),
    deletedAt: tstz(),
    ...timestamps,
    createdBy: createdBy(),
  },
  (t) => [
    check(
      "documents_exactly_one_subject",
      sql`num_nonnulls(${t.ownerId}, ${t.propertyId}, ${t.unitId}, ${t.tenantId}, ${t.leaseId}) = 1`,
    ),
    check("documents_size_limit", sql`${t.sizeBytes} > 0 and ${t.sizeBytes} <= 10485760`),
    check("documents_file_key_prefix", sql`${t.fileKey} like 'agencies/' || ${t.agencyId}::text || '/%'`),
    unique("documents_agency_id_id_key").on(t.agencyId, t.id),
    index("documents_agency_owner_idx").on(t.agencyId, t.ownerId),
    index("documents_agency_property_idx").on(t.agencyId, t.propertyId),
    index("documents_agency_unit_idx").on(t.agencyId, t.unitId),
    index("documents_agency_tenant_idx").on(t.agencyId, t.tenantId),
    index("documents_agency_lease_idx").on(t.agencyId, t.leaseId),
    index("documents_agency_status_idx").on(t.agencyId, t.status),
    foreignKey({ name: "documents_owner_fk", columns: [t.agencyId, t.ownerId], foreignColumns: [owners.agencyId, owners.id] }),
    foreignKey({ name: "documents_property_fk", columns: [t.agencyId, t.propertyId], foreignColumns: [properties.agencyId, properties.id] }),
    foreignKey({ name: "documents_unit_fk", columns: [t.agencyId, t.unitId], foreignColumns: [units.agencyId, units.id] }),
    foreignKey({ name: "documents_tenant_fk", columns: [t.agencyId, t.tenantId], foreignColumns: [tenants.agencyId, tenants.id] }),
    foreignKey({ name: "documents_lease_fk", columns: [t.agencyId, t.leaseId], foreignColumns: [leases.agencyId, leases.id] }),
  ],
);
