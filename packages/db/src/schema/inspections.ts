import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, integer, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agencyColumn, createdBy, pk, timestamps, tstz } from "./_columns";
import { agencies } from "./agencies";
import { leases } from "./leases";

// Ingoing and outgoing inspections (spec 2, lease lifecycle; Rental Housing
// Act s5(2)–(4); D118–D121). One of each per lease: a room-by-room checklist
// with a condition, notes and photos per item. Completing it freezes it and
// files a branded report with the lease, emailed to the tenant.

export const inspectionKind = pgEnum("inspection_kind", ["ingoing", "outgoing"]);
export const inspectionStatus = pgEnum("inspection_status", ["draft", "completed"]);
export const itemCondition = pgEnum("item_condition", ["good", "fair", "poor", "damaged", "missing", "not_applicable"]);

export const inspections = pgTable(
  "inspections",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    leaseId: uuid().notNull(),
    kind: inspectionKind().notNull(),
    status: inspectionStatus().notNull().default("draft"),
    inspectedOn: date().notNull(),
    // Who was there: the Act asks for a joint inspection
    attendees: text(),
    notes: text(),
    completedAt: tstz(),
    completedBy: uuid(),
    reportDocumentId: uuid(),
    ...timestamps,
    createdBy: createdBy(),
  },
  (t) => [
    uniqueIndex("inspections_agency_id_id_key").on(t.agencyId, t.id),
    uniqueIndex("inspections_agency_lease_kind_key").on(t.agencyId, t.leaseId, t.kind),
    foreignKey({ name: "inspections_lease_fk", columns: [t.agencyId, t.leaseId], foreignColumns: [leases.agencyId, leases.id] }),
    check("inspections_completed", sql`(${t.status} = 'completed') = (${t.completedAt} is not null)`),
  ],
);

export const inspectionItems = pgTable(
  "inspection_items",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    inspectionId: uuid().notNull(),
    position: integer().notNull(),
    room: text().notNull(),
    item: text().notNull(),
    condition: itemCondition(),
    notes: text(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("inspection_items_agency_id_id_key").on(t.agencyId, t.id),
    index("inspection_items_agency_inspection_idx").on(t.agencyId, t.inspectionId, t.position),
    foreignKey({ name: "inspection_items_inspection_fk", columns: [t.agencyId, t.inspectionId], foreignColumns: [inspections.agencyId, inspections.id] }).onDelete("cascade"),
  ],
);
