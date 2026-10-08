import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, ownerDb } from "../src/client";

// Structural guarantees for every table in the schema, present and future.
// A new table that forgets RLS, FORCE, or an agency policy fails here.

// agencies is RLS-protected but not FORCEd: its owner-run lookup function needs it.
const NOT_FORCED = new Set(["agencies"]);

interface TableRow extends Record<string, unknown> {
  table: string;
  rls: boolean;
  forced: boolean;
  has_agency_id: boolean;
  app_privs: string[];
}
interface PolicyRow extends Record<string, unknown> {
  tablename: string;
  policyname: string;
  roles: string[];
  cmd: string;
  qual: string | null;
  with_check: string | null;
}

afterAll(() => closeDb());

async function tables(): Promise<TableRow[]> {
  const { rows } = await ownerDb().execute<TableRow>(sql`
    SELECT c.relname AS table,
           c.relrowsecurity AS rls,
           c.relforcerowsecurity AS forced,
           EXISTS (SELECT 1 FROM pg_attribute a
                   WHERE a.attrelid = c.oid AND a.attname = 'agency_id' AND NOT a.attisdropped) AS has_agency_id,
           ARRAY(SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p
                 WHERE has_table_privilege('awdrent_app', c.oid, p)
                    OR (p IN ('SELECT','INSERT','UPDATE') AND has_any_column_privilege('awdrent_app', c.oid, p))) AS app_privs
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY 1`);
  return rows;
}

async function policies(): Promise<PolicyRow[]> {
  const { rows } = await ownerDb().execute<PolicyRow>(sql`
    SELECT tablename, policyname, roles::text[] AS roles, cmd, qual, with_check
    FROM pg_policies WHERE schemaname = 'public'`);
  return rows;
}

describe("row-level security structure", () => {
  it("has tables to check", async () => {
    expect((await tables()).length).toBeGreaterThan(5);
  });

  it("enables RLS on every table", async () => {
    const missing = (await tables()).filter((t) => !t.rls).map((t) => t.table);
    expect(missing).toEqual([]);
  });

  it("forces RLS on every table except the allow-list", async () => {
    const missing = (await tables()).filter((t) => !t.forced && !NOT_FORCED.has(t.table)).map((t) => t.table);
    expect(missing).toEqual([]);
  });

  it("never gives the app role TRUNCATE", async () => {
    const bad = (await tables()).filter((t) => t.app_privs.includes("TRUNCATE")).map((t) => t.table);
    expect(bad).toEqual([]);
  });

  it("scopes every app-visible table to the current agency", async () => {
    const all = await policies();
    const problems: string[] = [];
    for (const t of await tables()) {
      if (t.app_privs.length === 0) continue;
      const appPolicies = all.filter(
        (p) => p.tablename === t.table && (p.roles.includes("awdrent_app") || p.roles.includes("public")),
      );
      if (appPolicies.length === 0) problems.push(`${t.table}: app has ${t.app_privs.join("/")} but no policy`);
      const column = t.table === "agencies" ? "id" : "agency_id";
      const scoped = new RegExp(`\\b${column} = app_current_agency\\(\\)`);
      if (t.table !== "agencies" && !t.has_agency_id) problems.push(`${t.table}: app-visible but has no agency_id`);
      for (const p of appPolicies) {
        if (!p.qual || !scoped.test(p.qual)) problems.push(`${t.table}.${p.policyname}: USING is "${p.qual}"`);
        if (p.cmd !== "SELECT" && p.cmd !== "DELETE" && (!p.with_check || !scoped.test(p.with_check))) {
          problems.push(`${t.table}.${p.policyname}: WITH CHECK is "${p.with_check}"`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("makes agency_id NOT NULL wherever it exists", async () => {
    const { rows } = await ownerDb().execute<{ table_name: string }>(sql`
      SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'agency_id' AND is_nullable = 'YES'`);
    // platform_audit_log may record actions that are not about one agency
    expect(rows.map((r) => r.table_name).filter((t) => t !== "platform_audit_log")).toEqual([]);
  });

  it("gives no application role superuser or BYPASSRLS", async () => {
    const { rows } = await ownerDb().execute<{ rolname: string; privileged: boolean }>(sql`
      SELECT rolname, (rolsuper OR rolbypassrls) AS privileged FROM pg_roles
      WHERE rolname LIKE 'awdrent\_%' ORDER BY rolname`);
    expect(rows).toEqual(
      ["awdrent_app", "awdrent_auth", "awdrent_owner", "awdrent_platform"].map((rolname) => ({ rolname, privileged: false })),
    );
  });

  it("lets only the owner role own tables", async () => {
    const { rows } = await ownerDb().execute<{ relname: string; owner: string }>(sql`
      SELECT c.relname, pg_get_userbyid(c.relowner) AS owner
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'S')
        AND pg_get_userbyid(c.relowner) <> 'awdrent_owner'`);
    expect(rows).toEqual([]);
  });

  it("leads every agency index with agency_id", async () => {
    // Indexes on agency tables that filter by something else first are
    // usually a mistake; unique keys on global identifiers are listed here.
    const allowed = new Set(["users_email_key", "auth_sessions_token_key"]);
    const { rows } = await ownerDb().execute<{ indexname: string; indexdef: string }>(sql`
      SELECT i.indexname, i.indexdef FROM pg_indexes i
      WHERE i.schemaname = 'public'
        AND EXISTS (SELECT 1 FROM information_schema.columns c
                    WHERE c.table_schema = 'public' AND c.table_name = i.tablename AND c.column_name = 'agency_id')
        AND i.indexname NOT LIKE '%_pkey'
        AND i.tablename NOT IN ('support_sessions', 'platform_audit_log', 'auth_sessions', 'provider_messages')`);
    const bad = rows
      .filter((r) => !allowed.has(r.indexname))
      .filter((r) => !/\(agency_id[,)]/.test(r.indexdef))
      .map((r) => r.indexname);
    expect(bad).toEqual([]);
  });
});
