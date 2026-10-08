import "./load-env";
import { sql } from "drizzle-orm";
import { closeDb, ownerDb } from "../src/client";
import { runMigrations } from "../src/migrate";

/** Drops everything in the test database and migrates from scratch. */
export default async function setup(): Promise<void> {
  const db = ownerDb();
  await db.execute(sql.raw(`
    DROP SCHEMA IF EXISTS drizzle CASCADE;
    DROP SCHEMA public CASCADE;
    CREATE SCHEMA public;
    REVOKE ALL ON SCHEMA public FROM PUBLIC;
    GRANT USAGE ON SCHEMA public TO awdrent_app, awdrent_auth, awdrent_platform;
  `));
  await runMigrations();
  await closeDb();
}
