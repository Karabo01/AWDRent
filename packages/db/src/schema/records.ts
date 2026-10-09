import { boolean, foreignKey, index, integer, pgEnum, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agencyColumn, createdBy, pk, timestamps, tstz } from "./_columns";
import { agencies } from "./agencies";
import { users } from "./staff";

// Owners, properties, units and agent portfolios. Every reference between
// these tables is a composite (agency_id, id) foreign key (decision D13).

export const ownerKind = pgEnum("owner_kind", ["individual", "company", "trust"]);

export const commissionModel = pgEnum("commission_model", ["first_month", "percent"]);

export const owners = pgTable(
  "owners",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    kind: ownerKind().notNull().default("individual"),
    name: text().notNull(),
    // SA ID / passport / company or trust registration number (encrypted)
    idOrRegNoEnc: text(),
    idOrRegNoLast4: text(),
    idOrRegNoBlindIndex: text(),
    email: text(),
    phone: text(),
    postalAddress: text(),
    // Payout bank details (decision D6: admins only)
    bankName: text(),
    bankBranchCode: text(),
    bankAccountHolder: text(),
    bankAccountNoEnc: text(),
    bankAccountNoLast4: text(),
    // Owner portal access (D104): switched on per owner by staff
    portalEnabled: boolean().notNull().default(false),
    // How the agency is paid (D91): the first month's rent of each new lease, or a percentage of rent collected
    commissionModel: commissionModel().notNull().default("first_month"),
    // Commission in basis points for the percentage model: 1050 = 10.5% (decision D11)
    commissionBps: integer().notNull().default(0),
    vatRegistered: boolean().notNull().default(false),
    vatNumber: text(),
    notes: text(),
    archivedAt: tstz(),
    ...timestamps,
    createdBy: createdBy(),
  },
  (t) => [
    unique("owners_agency_id_id_key").on(t.agencyId, t.id),
    index("owners_agency_name_idx").on(t.agencyId, t.name),
    index("owners_agency_id_index_idx").on(t.agencyId, t.idOrRegNoBlindIndex),
  ],
);

export const propertyType = pgEnum("property_type", ["house", "apartment_block", "complex", "commercial", "mixed_use", "other"]);

export const properties = pgTable(
  "properties",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    ownerId: uuid().notNull(),
    name: text().notNull(),
    type: propertyType().notNull().default("house"),
    addressLine1: text().notNull(),
    addressLine2: text(),
    suburb: text(),
    city: text().notNull(),
    province: text(),
    postalCode: text(),
    notes: text(),
    archivedAt: tstz(),
    ...timestamps,
    createdBy: createdBy(),
  },
  (t) => [
    unique("properties_agency_id_id_key").on(t.agencyId, t.id),
    index("properties_agency_owner_idx").on(t.agencyId, t.ownerId),
    index("properties_agency_name_idx").on(t.agencyId, t.name),
    foreignKey({ name: "properties_owner_fk", columns: [t.agencyId, t.ownerId], foreignColumns: [owners.agencyId, owners.id] }),
  ],
);

export const unitStatus = pgEnum("unit_status", ["vacant", "occupied", "notice_given", "under_maintenance"]);

export const units = pgTable(
  "units",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    propertyId: uuid().notNull(),
    // "Flat 4", "Main house", "Shop 2"
    label: text().notNull(),
    bedrooms: integer(),
    bathrooms: integer(),
    status: unitStatus().notNull().default("vacant"),
    notes: text(),
    archivedAt: tstz(),
    ...timestamps,
    createdBy: createdBy(),
  },
  (t) => [
    unique("units_agency_id_id_key").on(t.agencyId, t.id),
    uniqueIndex("units_agency_property_label_key").on(t.agencyId, t.propertyId, t.label),
    index("units_agency_status_idx").on(t.agencyId, t.status),
    foreignKey({
      name: "units_property_fk",
      columns: [t.agencyId, t.propertyId],
      foreignColumns: [properties.agencyId, properties.id],
    }),
  ],
);

/** Which properties an agent manages (decision D8; enforced in permissions code). */
export const agentPortfolios = pgTable(
  "agent_portfolios",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    userId: uuid().notNull(),
    propertyId: uuid().notNull(),
    ...timestamps,
    createdBy: createdBy(),
  },
  (t) => [
    uniqueIndex("agent_portfolios_agency_user_property_key").on(t.agencyId, t.userId, t.propertyId),
    index("agent_portfolios_agency_property_idx").on(t.agencyId, t.propertyId),
    foreignKey({ name: "agent_portfolios_user_fk", columns: [t.agencyId, t.userId], foreignColumns: [users.agencyId, users.id] }),
    foreignKey({
      name: "agent_portfolios_property_fk",
      columns: [t.agencyId, t.propertyId],
      foreignColumns: [properties.agencyId, properties.id],
    }).onDelete("cascade"),
  ],
);
