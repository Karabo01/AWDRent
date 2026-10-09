import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agencyColumn, pk, timestamps, tstz } from "./_columns";
import { agencies } from "./agencies";
import { tenants } from "./leases";
import { owners } from "./records";

// Tenant portal logins (D41, D76): the third Better Auth instance. No
// passwords; a one-time code by email or SMS signs in. A portal user belongs
// to one agency and one tenant record; the same person at two agencies has
// two portal users. Field names follow Better Auth's user model.

export const portalUsers = pgTable(
  "portal_users",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    // Exactly one of: the tenant or the owner this login is for (D104)
    tenantId: uuid(),
    ownerId: uuid(),
    name: text().notNull(),
    // Required by Better Auth; the tenant's email, or a placeholder for phone-only tenants. Not used to sign in.
    email: text().notNull(),
    emailVerified: boolean().notNull().default(false),
    image: text(),
    active: boolean().notNull().default(true),
    lastLoginAt: tstz(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("portal_users_agency_id_id_key").on(t.agencyId, t.id),
    uniqueIndex("portal_users_agency_tenant_key").on(t.agencyId, t.tenantId),
    uniqueIndex("portal_users_agency_owner_key").on(t.agencyId, t.ownerId),
    foreignKey({ name: "portal_users_tenant_fk", columns: [t.agencyId, t.tenantId], foreignColumns: [tenants.agencyId, tenants.id] }),
    foreignKey({ name: "portal_users_owner_fk", columns: [t.agencyId, t.ownerId], foreignColumns: [owners.agencyId, owners.id] }),
    check("portal_users_one_party", sql`num_nonnulls(${t.tenantId}, ${t.ownerId}) = 1`),
  ],
);

export const portalSessions = pgTable(
  "portal_sessions",
  {
    id: pk(),
    userId: uuid().notNull(),
    // Copied from the portal user at sign-in; the host's agency must match it
    agencyId: uuid().notNull(),
    token: text().notNull(),
    expiresAt: tstz().notNull(),
    ipAddress: text(),
    userAgent: text(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("portal_sessions_token_key").on(t.token),
    index("portal_sessions_user_idx").on(t.userId),
    foreignKey({ name: "portal_sessions_user_fk", columns: [t.agencyId, t.userId], foreignColumns: [portalUsers.agencyId, portalUsers.id] }).onDelete(
      "cascade",
    ),
  ],
);

/** One-time codes: only a keyed hash of the code is stored, with its attempt count. */
export const portalVerifications = pgTable(
  "portal_verifications",
  {
    id: pk(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: tstz().notNull(),
    ...timestamps,
  },
  (t) => [index("portal_verifications_identifier_idx").on(t.identifier)],
);

/**
 * Better Auth's account model. Portal sign-in has no passwords or linked
 * providers, so this stays empty; Better Auth needs the table to exist.
 */
export const portalAccounts = pgTable(
  "portal_accounts",
  {
    id: pk(),
    userId: uuid()
      .notNull()
      .references(() => portalUsers.id, { onDelete: "cascade" }),
    accountId: text().notNull(),
    providerId: text().notNull(),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: tstz(),
    refreshTokenExpiresAt: tstz(),
    scope: text(),
    password: text(),
    ...timestamps,
  },
  (t) => [index("portal_accounts_user_idx").on(t.userId)],
);
