import { sql } from "drizzle-orm";
import { timestamp, uuid } from "drizzle-orm/pg-core";

// Shared column builders. The SQL functions app_current_agency() and
// app_current_user() are created in migration 0000 and read the
// transaction-local settings that withAgency() sets.

export const pk = () => uuid().primaryKey().default(sql`gen_random_uuid()`);

export const tstz = () => timestamp({ withTimezone: true });

export const timestamps = {
  createdAt: tstz().notNull().defaultNow(),
  updatedAt: tstz().notNull().defaultNow(),
};

/** Staff user who created the row; null for system jobs and platform actions. */
export const createdBy = () => uuid().default(sql`app_current_user()`);

/**
 * Every agency-scoped table gets this. It defaults to the agency of the
 * current transaction, and the RLS WITH CHECK clause rejects any other value.
 */
export const agencyColumn = () => uuid().notNull().default(sql`app_current_agency()`);
