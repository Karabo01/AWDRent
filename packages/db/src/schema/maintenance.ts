import { boolean, foreignKey, index, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agencyColumn, createdBy, pk, timestamps, tstz } from "./_columns";
import { agencies } from "./agencies";
import { leases, tenants } from "./leases";
import { units } from "./records";

// Maintenance (spec 6; D100–D103). Tenants log requests in the portal (or
// staff log them); agents set the priority, assign a contractor (who is
// emailed a job card) and move the status on, and the tenant is told. Owners
// pay contractors directly, so no costs are recorded here (D93).

export const maintenancePriority = pgEnum("maintenance_priority", ["low", "normal", "urgent", "emergency"]);
export const maintenanceStatus = pgEnum("maintenance_status", ["open", "assigned", "in_progress", "completed", "cancelled"]);

export const contractors = pgTable(
  "contractors",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    name: text().notNull(),
    // e.g. plumber, electrician, handyman
    trade: text(),
    email: text(),
    phone: text(),
    notes: text(),
    active: boolean().notNull().default(true),
    ...timestamps,
    createdBy: createdBy(),
  },
  (t) => [uniqueIndex("contractors_agency_id_id_key").on(t.agencyId, t.id), index("contractors_agency_name_idx").on(t.agencyId, t.name)],
);

export const maintenanceRequests = pgTable(
  "maintenance_requests",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    unitId: uuid().notNull(),
    leaseId: uuid(),
    // The tenant who logged it in the portal
    tenantId: uuid(),
    reportedVia: text().notNull(),
    title: text().notNull(),
    description: text().notNull(),
    priority: maintenancePriority().notNull().default("normal"),
    status: maintenanceStatus().notNull().default("open"),
    contractorId: uuid(),
    completedAt: tstz(),
    ...timestamps,
    createdBy: createdBy(),
  },
  (t) => [
    uniqueIndex("maintenance_requests_agency_id_id_key").on(t.agencyId, t.id),
    index("maintenance_requests_agency_status_idx").on(t.agencyId, t.status, t.createdAt),
    index("maintenance_requests_agency_unit_idx").on(t.agencyId, t.unitId),
    foreignKey({ name: "maintenance_requests_unit_fk", columns: [t.agencyId, t.unitId], foreignColumns: [units.agencyId, units.id] }),
    foreignKey({ name: "maintenance_requests_lease_fk", columns: [t.agencyId, t.leaseId], foreignColumns: [leases.agencyId, leases.id] }),
    foreignKey({ name: "maintenance_requests_tenant_fk", columns: [t.agencyId, t.tenantId], foreignColumns: [tenants.agencyId, tenants.id] }),
    foreignKey({ name: "maintenance_requests_contractor_fk", columns: [t.agencyId, t.contractorId], foreignColumns: [contractors.agencyId, contractors.id] }),
  ],
);

/** The request's timeline: status changes and notes, kept like an audit trail. */
export const maintenanceUpdates = pgTable(
  "maintenance_updates",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    requestId: uuid().notNull(),
    // Set when the update changed the status
    status: maintenanceStatus(),
    note: text(),
    // Shown to the tenant in the portal and in their message
    visibleToTenant: boolean().notNull().default(true),
    // A tenant adding to their own request in the portal
    portalUserId: uuid(),
    createdAt: tstz().notNull().defaultNow(),
    createdBy: createdBy(),
  },
  (t) => [
    index("maintenance_updates_agency_request_idx").on(t.agencyId, t.requestId),
    foreignKey({
      name: "maintenance_updates_request_fk",
      columns: [t.agencyId, t.requestId],
      foreignColumns: [maintenanceRequests.agencyId, maintenanceRequests.id],
    }),
  ],
);
