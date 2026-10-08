import { eq, sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authDb, closeDb, withAgency, withPlatform } from "../src/client";
import { agencies, authSessions, users } from "../src/schema";
import { createAgencyWithAdmin } from "./fixtures";

// Cross-agency attempts against the core tables. Every one must fail.

let a: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let b: Awaited<ReturnType<typeof createAgencyWithAdmin>>;

beforeAll(async () => {
  a = await createAgencyWithAdmin("Alpha");
  b = await createAgencyWithAdmin("Bravo");
});
afterAll(() => closeDb());

/** Unwraps the Postgres error drizzle wraps in a DrizzleQueryError. */
async function pgError(p: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await p;
  } catch (err) {
    const cause = (err as { cause?: { code?: string; message: string } }).cause;
    return cause ?? (err as { message: string });
  }
  throw new Error("expected the query to fail");
}

describe("users across agencies", () => {
  it("lists only the current agency's staff", async () => {
    const rows = await withAgency({ agencyId: a.agency.id }, (tx) => tx.select().from(users));
    expect(rows.map((r) => r.id)).toEqual([a.admin.id]);
  });

  it("returns nothing when reading another agency's user by id", async () => {
    const rows = await withAgency({ agencyId: a.agency.id }, (tx) =>
      tx.select().from(users).where(eq(users.id, b.admin.id)),
    );
    expect(rows).toEqual([]);
  });

  it("updates nothing when targeting another agency's user", async () => {
    const rows = await withAgency({ agencyId: a.agency.id }, (tx) =>
      tx.update(users).set({ name: "hijacked" }).where(eq(users.id, b.admin.id)).returning(),
    );
    expect(rows).toEqual([]);
    const [still] = await withAgency({ agencyId: b.agency.id }, (tx) =>
      tx.select().from(users).where(eq(users.id, b.admin.id)),
    );
    expect(still?.name).toBe("Bravo Admin");
  });

  it("rejects inserting a user into another agency", async () => {
    const err = await pgError(
      withAgency({ agencyId: a.agency.id }, (tx) =>
        tx.insert(users).values({ agencyId: b.agency.id, name: "Mole", email: "mole@x.test", role: "admin" }),
      ),
    );
    expect(err.message).toMatch(/row-level security/);
  });

  it("rejects moving a user to another agency", async () => {
    const err = await pgError(
      withAgency({ agencyId: a.agency.id }, (tx) =>
        tx.execute(sql`update users set agency_id = ${b.agency.id} where id = ${a.admin.id}`),
      ),
    );
    // agency_id is not in the app role's column grants
    expect(err.code).toBe("42501");
  });

  it("does not allow deleting users at all", async () => {
    const err = await pgError(
      withAgency({ agencyId: a.agency.id }, (tx) => tx.delete(users).where(eq(users.id, a.admin.id))),
    );
    expect(err.code).toBe("42501");
  });

  it("refuses writes in a read-only (support) transaction", async () => {
    const err = await pgError(
      withAgency({ agencyId: a.agency.id, readOnly: true }, (tx) =>
        tx.update(users).set({ name: "x" }).where(eq(users.id, a.admin.id)),
      ),
    );
    expect(err.code).toBe("25006"); // read_only_sql_transaction
  });
});

describe("agencies table", () => {
  it("shows the app role only its own agency", async () => {
    const rows = await withAgency({ agencyId: a.agency.id }, (tx) => tx.select().from(agencies));
    expect(rows.map((r) => r.id)).toEqual([a.agency.id]);
  });

  it("does not let an agency change its own plan or status", async () => {
    const err = await pgError(
      withAgency({ agencyId: a.agency.id }, (tx) =>
        tx.update(agencies).set({ status: "active", includedUnits: 9999 }).where(eq(agencies.id, a.agency.id)),
      ),
    );
    expect(err.code).toBe("42501");
  });

  it("does not let an agency update another agency's settings", async () => {
    const rows = await withAgency({ agencyId: a.agency.id }, (tx) =>
      tx.update(agencies).set({ name: "renamed" }).where(eq(agencies.id, b.agency.id)).returning(),
    );
    expect(rows).toEqual([]);
  });

  it("resolves public branding by subdomain without bank details", async () => {
    const { rows } = await withAgency({ agencyId: a.agency.id }, (tx) =>
      tx.execute(sql`select * from agency_public_by_subdomain(${b.agency.subdomain})`),
    );
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(["brand_colour", "id", "logo_key", "name", "status", "subdomain"]);
  });
});

describe("other roles", () => {
  it("hides auth tables from the app role", async () => {
    const err = await pgError(withAgency({ agencyId: a.agency.id }, (tx) => tx.select().from(authSessions)));
    expect(err.code).toBe("42501");
  });

  it("hides agency staff from the platform role", async () => {
    const err = await pgError(withPlatform((tx) => tx.select().from(users)));
    expect(err.code).toBe("42501");
  });

  it("lets the auth role read users across agencies but not rename them", async () => {
    const rows = await authDb().select({ id: users.id }).from(users);
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining([a.admin.id, b.admin.id]));
    const err = await pgError(authDb().update(users).set({ name: "x" }).where(eq(users.id, a.admin.id)));
    expect(err.code).toBe("42501");
  });

  it("rejects an auth session whose agency does not match the user's", async () => {
    const err = await pgError(
      authDb()
        .insert(authSessions)
        .values({ userId: a.admin.id, agencyId: b.agency.id, token: "t-mismatch", expiresAt: new Date(Date.now() + 60_000) }),
    );
    expect(err.code).toBe("23503"); // foreign_key_violation
  });
});

describe("connection hygiene", () => {
  it("sees no rows when no agency is set", async () => {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const { rows } = await client.query("select count(*)::int as n from users");
      expect(rows[0].n).toBe(0);
    } finally {
      await client.end();
    }
  });

  it("does not leak the agency setting past the transaction", async () => {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.agency_id', $1, true)", [a.agency.id]);
      await client.query("commit");
      const { rows } = await client.query("select app_current_agency() as agency, count(*)::int as n from users");
      expect(rows[0]).toEqual({ agency: null, n: 0 });
    } finally {
      await client.end();
    }
  });

  it("rejects a non-UUID agency id before touching the database", async () => {
    await expect(withAgency({ agencyId: "' or 1=1 --" }, async () => 1)).rejects.toThrow(/not a UUID/);
  });
});
