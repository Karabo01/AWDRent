import { boolean, index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { pk, timestamps, tstz } from "./_columns";
import { agencies } from "./agencies";

// ─── AWDTECH staff: outside any agency ────────────────────────────────
// Field names follow Better Auth's models; this is the second auth instance.

export const platformAdmins = pgTable(
  "platform_admins",
  {
    id: pk(),
    name: text().notNull(),
    email: text().notNull(),
    emailVerified: boolean().notNull().default(false),
    image: text(),
    twoFactorEnabled: boolean().notNull().default(false),
    lastLoginAt: tstz(),
    ...timestamps,
  },
  (t) => [uniqueIndex("platform_admins_email_key").on(t.email)],
);

export const platformSessions = pgTable(
  "platform_sessions",
  {
    id: pk(),
    userId: uuid()
      .notNull()
      .references(() => platformAdmins.id, { onDelete: "cascade" }),
    token: text().notNull(),
    expiresAt: tstz().notNull(),
    ipAddress: text(),
    userAgent: text(),
    ...timestamps,
  },
  (t) => [uniqueIndex("platform_sessions_token_key").on(t.token), index("platform_sessions_user_idx").on(t.userId)],
);

export const platformAccounts = pgTable(
  "platform_accounts",
  {
    id: pk(),
    userId: uuid()
      .notNull()
      .references(() => platformAdmins.id, { onDelete: "cascade" }),
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
  (t) => [index("platform_accounts_user_idx").on(t.userId)],
);

export const platformVerifications = pgTable(
  "platform_verifications",
  {
    id: pk(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: tstz().notNull(),
    ...timestamps,
  },
  (t) => [index("platform_verifications_identifier_idx").on(t.identifier)],
);

export const platformTwoFactors = pgTable(
  "platform_two_factors",
  {
    id: pk(),
    userId: uuid()
      .notNull()
      .references(() => platformAdmins.id, { onDelete: "cascade" }),
    // Encrypted by Better Auth with PLATFORM_AUTH_SECRET
    secret: text().notNull(),
    backupCodes: text().notNull(),
  },
  (t) => [uniqueIndex("platform_two_factors_user_key").on(t.userId)],
);

/**
 * A platform admin's time-limited access to one agency's data (decision D5).
 * Read-only unless write access was confirmed.
 */
export const supportSessions = pgTable(
  "support_sessions",
  {
    id: pk(),
    platformAdminId: uuid()
      .notNull()
      .references(() => platformAdmins.id),
    agencyId: uuid()
      .notNull()
      .references(() => agencies.id),
    reason: text().notNull(),
    writeAccess: boolean().notNull().default(false),
    writeConfirmedAt: tstz(),
    startedAt: tstz().notNull().defaultNow(),
    expiresAt: tstz().notNull(),
    endedAt: tstz(),
    ...timestamps,
  },
  (t) => [index("support_sessions_agency_idx").on(t.agencyId, t.startedAt)],
);

/** Append-only log of platform-level actions (agency created, suspended, ...). */
export const platformAuditLog = pgTable(
  "platform_audit_log",
  {
    id: pk(),
    platformAdminId: uuid().references(() => platformAdmins.id),
    action: text().notNull(),
    agencyId: uuid().references(() => agencies.id),
    before: jsonb(),
    after: jsonb(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [index("platform_audit_log_agency_idx").on(t.agencyId, t.createdAt)],
);
