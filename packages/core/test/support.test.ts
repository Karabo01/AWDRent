import { closeDb, schema, withAgency, withPlatform } from "@awdrent/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authDb } from "../../db/src/client";
import { createAgencyWithAdmin } from "../../db/test/fixtures";
import { createAgency, EmailTakenError, SubdomainTakenError } from "../src/platform";
import {
  activeSupportSession,
  consumeEntryToken,
  endSupportSession,
  enableSupportWriteAccess,
  logSupportView,
  readSupportCookie,
  startSupportSession,
  supportCookieValue,
} from "../src/support";

let a: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let b: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let platformAdminId: string;

beforeAll(async () => {
  a = await createAgencyWithAdmin("SupA");
  b = await createAgencyWithAdmin("SupB");
  const [admin] = await authDb()
    .execute<{ id: string }>(sql`select id from platform_admins limit 1`)
    .then((r) => r.rows);
  platformAdminId = admin?.id ?? (await insertPlatformAdmin());
});
afterAll(() => closeDb());

async function insertPlatformAdmin(): Promise<string> {
  const { ownerDb } = await import("../../db/src/client");
  const [row] = await ownerDb()
    .insert(schema.platformAdmins)
    .values({ name: "Test Admin", email: `pa-${Date.now()}@awdtech.test` })
    .returning();
  return row!.id;
}

describe("support entry tokens", () => {
  it("can be spent once, only on the agency they were issued for", async () => {
    const { session, entryToken } = await startSupportSession(platformAdminId, a.agency.id, "Checking a lease screen");
    expect(await consumeEntryToken(entryToken, b.agency.id)).toBeNull();
    expect((await consumeEntryToken(entryToken, a.agency.id))?.id).toBe(session.id);
    expect(await consumeEntryToken(entryToken, a.agency.id)).toBeNull();
  });

  it("expire after a minute", async () => {
    const { session, entryToken } = await startSupportSession(platformAdminId, a.agency.id, "Checking expiry rules");
    await withPlatform((tx) =>
      tx
        .update(schema.supportSessions)
        .set({ entryTokenExpiresAt: sql`now() - interval '1 second'` })
        .where(eq(schema.supportSessions.id, session.id)),
    );
    expect(await consumeEntryToken(entryToken, a.agency.id)).toBeNull();
  });

  it("stop working once the session is ended", async () => {
    const { session, entryToken } = await startSupportSession(platformAdminId, a.agency.id, "Ending the session early");
    await endSupportSession(platformAdminId, session.id);
    expect(await consumeEntryToken(entryToken, a.agency.id)).toBeNull();
    expect(await activeSupportSession(session.id, a.agency.id)).toBeNull();
  });
});

describe("support cookie", () => {
  it("rejects a tampered session id", () => {
    const value = supportCookieValue("11111111-1111-4111-8111-111111111111");
    expect(readSupportCookie(value)).toBe("11111111-1111-4111-8111-111111111111");
    expect(readSupportCookie(value.replace(/^1/, "2"))).toBeNull();
    expect(readSupportCookie("garbage")).toBeNull();
    expect(readSupportCookie(undefined)).toBeNull();
  });
});

describe("support access to agency data", () => {
  it("is read-only until write access is confirmed, and every view is logged", async () => {
    const { session } = await startSupportSession(platformAdminId, a.agency.id, "Read-only investigation");
    const active = await activeSupportSession(session.id, a.agency.id);
    expect(active).not.toBeNull();
    // Not usable on another agency
    expect(await activeSupportSession(session.id, b.agency.id)).toBeNull();

    const ctx = { agencyId: a.agency.id, supportSessionId: session.id, readOnly: !active!.session.writeAccess };
    const users = await withAgency(ctx, (tx) => tx.select().from(schema.users));
    expect(users.map((u) => u.id)).toEqual([a.admin.id]);
    await expect(
      withAgency(ctx, (tx) => tx.update(schema.users).set({ name: "changed" }).where(eq(schema.users.id, a.admin.id))),
    ).rejects.toThrow();

    await logSupportView(ctx, "/owners");
    const [entry] = await withAgency({ agencyId: a.agency.id }, (tx) =>
      tx.select().from(schema.auditLog).where(eq(schema.auditLog.supportSessionId, session.id)),
    );
    expect(entry).toMatchObject({ action: "support.page_viewed", userId: null, after: { path: "/owners" } });

    await enableSupportWriteAccess(platformAdminId, session.id);
    expect((await activeSupportSession(session.id, a.agency.id))?.session.writeAccess).toBe(true);
  });
});

describe("creating agencies", () => {
  it("creates the agency and its first admin inside that agency only", async () => {
    const sub = `new-${Date.now().toString(36)}`;
    const { agency, adminUserId } = await createAgency(platformAdminId, {
      name: "Brand New Lettings",
      subdomain: sub,
      eftPrefix: "BN",
      plan: "standard",
      includedUnits: 50,
      includedSms: 200,
      adminName: "First Admin",
      adminEmail: `first@${sub}.test`,
    });
    const staff = await withAgency({ agencyId: agency.id }, (tx) => tx.select().from(schema.users));
    expect(staff.map((u) => [u.id, u.role])).toEqual([[adminUserId, "admin"]]);
    const log = await withAgency({ agencyId: agency.id }, (tx) => tx.select().from(schema.auditLog));
    expect(log.map((l) => l.action)).toContain("user.created");
  });

  it("refuses a taken subdomain or staff email", async () => {
    const base = {
      name: "Clash",
      eftPrefix: "CL",
      plan: "standard",
      includedUnits: 0,
      includedSms: 0,
      adminName: "Clash Admin",
    };
    await expect(
      createAgency(platformAdminId, { ...base, subdomain: a.agency.subdomain, adminEmail: "unique@clash.test" }),
    ).rejects.toBeInstanceOf(SubdomainTakenError);
    await expect(
      createAgency(platformAdminId, { ...base, subdomain: `clash-${Date.now().toString(36)}`, adminEmail: a.admin.email }),
    ).rejects.toBeInstanceOf(EmailTakenError);
  });
});
