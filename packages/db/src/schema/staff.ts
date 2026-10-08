import { sql } from "drizzle-orm";
import { boolean, foreignKey, index, pgEnum, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agencyColumn, pk, timestamps, tstz } from "./_columns";
import { agencies } from "./agencies";

export const staffRole = pgEnum("staff_role", ["admin", "agent", "accounts"]);

/**
 * Agency staff. Doubles as Better Auth's "user" model. The auth role reads it
 * across agencies to log people in; the app role sees only its own agency.
 * Email is unique across the platform (decision D7).
 */
export const users = pgTable(
  "users",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    name: text().notNull(),
    email: text().notNull(),
    emailVerified: boolean().notNull().default(false),
    image: text(),
    phone: text(),
    role: staffRole().notNull(),
    active: boolean().notNull().default(true),
    twoFactorEnabled: boolean().notNull().default(false),
    lastLoginAt: tstz(),
    ...timestamps,
    // Staff user or (when null) platform admin / system
    createdBy: uuid(),
  },
  (t) => [
    uniqueIndex("users_email_key").on(sql`lower(${t.email})`),
    // Target for composite foreign keys from other agency tables
    unique("users_agency_id_id_key").on(t.agencyId, t.id),
    index("users_agency_role_idx").on(t.agencyId, t.role),
  ],
);

// Better Auth's session/account/verification/twoFactor models. Only the auth
// role has grants on these; the app role cannot read them at all.

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: pk(),
    userId: uuid().notNull(),
    // Copied from the user at login; the host's agency must match it
    agencyId: uuid().notNull(),
    token: text().notNull(),
    expiresAt: tstz().notNull(),
    ipAddress: text(),
    userAgent: text(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("auth_sessions_token_key").on(t.token),
    index("auth_sessions_user_idx").on(t.userId),
    foreignKey({
      name: "auth_sessions_user_fk",
      columns: [t.agencyId, t.userId],
      foreignColumns: [users.agencyId, users.id],
    }).onDelete("cascade"),
  ],
);

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: pk(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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
  (t) => [index("auth_accounts_user_idx").on(t.userId)],
);

export const authVerifications = pgTable(
  "auth_verifications",
  {
    id: pk(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: tstz().notNull(),
    ...timestamps,
  },
  (t) => [index("auth_verifications_identifier_idx").on(t.identifier)],
);

export const authTwoFactors = pgTable(
  "auth_two_factors",
  {
    id: pk(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Encrypted by Better Auth with BETTER_AUTH_SECRET
    secret: text().notNull(),
    backupCodes: text().notNull(),
  },
  (t) => [uniqueIndex("auth_two_factors_user_key").on(t.userId)],
);
