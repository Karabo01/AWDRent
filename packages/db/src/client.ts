import { env } from "@awdrent/config";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

// One pool per database role. Nothing outside this package gets a pool or a
// bare database handle for the app role: agency data is only reachable
// through withAgency(), which always sets the agency first.

export type Schema = typeof schema;
type Db = NodePgDatabase<Schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const pools = new Map<string, pg.Pool>();
const dbs = new Map<string, Db>();

function dbFor(kind: "app" | "auth" | "platform" | "owner"): Db {
  const existing = dbs.get(kind);
  if (existing) return existing;
  const e = env();
  const url = {
    app: e.DATABASE_URL,
    auth: e.DATABASE_AUTH_URL,
    platform: e.DATABASE_PLATFORM_URL,
    owner: e.DATABASE_OWNER_URL,
  }[kind];
  if (!url) throw new Error(`No database URL configured for the ${kind} role`);
  const pool = new pg.Pool({ connectionString: url, max: kind === "app" ? 20 : 5 });
  const db = drizzle(pool, { schema, casing: "snake_case" });
  pools.set(kind, pool);
  dbs.set(kind, db);
  return db;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AgencyContext {
  /** From the authenticated session or the job payload. Never from request input. */
  agencyId: string;
  /** Staff user acting; omitted for system jobs. */
  userId?: string | null;
  /** Set when a platform admin acts under a support session. */
  supportSessionId?: string | null;
  /** Tenant acting in the portal, from the verified portal session (D76). */
  portalUserId?: string | null;
  /** Runs the transaction READ ONLY; Postgres rejects any write. */
  readOnly?: boolean;
}

/**
 * Runs `fn` in a transaction scoped to one agency. Row-level security makes
 * every other agency's rows invisible and unwritable inside it.
 */
export async function withAgency<T>(ctx: AgencyContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  assertUuid(ctx.agencyId, "agencyId");
  if (ctx.userId) assertUuid(ctx.userId, "userId");
  if (ctx.supportSessionId) assertUuid(ctx.supportSessionId, "supportSessionId");
  if (ctx.portalUserId) assertUuid(ctx.portalUserId, "portalUserId");
  return dbFor("app").transaction(
    async (tx) => {
      await setContext(tx, ctx);
      return fn(tx);
    },
    ctx.readOnly ? { accessMode: "read only" } : undefined,
  );
}

export interface PublicAgency extends Record<string, unknown> {
  id: string;
  name: string;
  subdomain: string;
  logo_key: string | null;
  brand_colour: string;
  status: "active" | "suspended";
}

/**
 * Branding for a host before anyone is logged in. Goes through a
 * SECURITY DEFINER function that returns no bank or billing details.
 */
export async function publicAgencyBySubdomain(subdomain: string): Promise<PublicAgency | null> {
  const { rows } = await dbFor("app").execute<PublicAgency>(
    sql`select * from agency_public_by_subdomain(${subdomain})`,
  );
  return rows[0] ?? null;
}

/** Platform console: agencies, support sessions, platform audit. No agency data. */
export async function withPlatform<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return dbFor("platform").transaction(fn);
}

/** Better Auth's database handle (login tables only). */
export function authDb(): Db {
  return dbFor("auth");
}

/**
 * Owner connection for migrations, seed and tests. FORCE RLS still applies,
 * so agency tables still need withOwnerAgency().
 */
export function ownerDb(): Db {
  return dbFor("owner");
}

export async function withOwnerAgency<T>(ctx: AgencyContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  assertUuid(ctx.agencyId, "agencyId");
  return ownerDb().transaction(async (tx) => {
    await setContext(tx, ctx);
    return fn(tx);
  });
}

async function setContext(tx: Tx, ctx: AgencyContext): Promise<void> {
  await tx.execute(sql`select
    set_config('app.agency_id', ${ctx.agencyId}, true),
    set_config('app.user_id', ${ctx.userId ?? ""}, true),
    set_config('app.support_session_id', ${ctx.supportSessionId ?? ""}, true),
    set_config('app.portal_user_id', ${ctx.portalUserId ?? ""}, true)`);
}

function assertUuid(value: string, name: string): void {
  if (!UUID_RE.test(value)) throw new Error(`${name} is not a UUID`);
}

export async function closeDb(): Promise<void> {
  const all = [...pools.values()];
  pools.clear();
  dbs.clear();
  await Promise.all(all.map((p) => p.end()));
}
