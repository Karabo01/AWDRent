import { createServer, type Server } from "node:net";
import { CreateBucketCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@awdrent/config";
import { closeDb, publicAgencyBySubdomain } from "@awdrent/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgencyWithAdmin } from "../../db/test/fixtures";
import { logoFile, LogoRejectedError, removeLogo, scanLogo, uploadLogo } from "../src/branding";
import { ForbiddenError } from "../src/permissions";
import type { Actor } from "../src/portfolio";
import { inviteStaff } from "../src/staff";
import { StorageAccessError } from "../src/storage";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const EICAR_PNG = Buffer.concat([PNG, Buffer.from("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")]);

let clamd: Server;
let port = 0;
let a: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let b: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let adminA: Actor;
let adminB: Actor;

const s3 = () =>
  new S3Client({
    endpoint: env().S3_ENDPOINT,
    region: env().S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env().S3_ACCESS_KEY_ID, secretAccessKey: env().S3_SECRET_ACCESS_KEY },
  });
const exists = (key: string) =>
  s3()
    .send(new HeadObjectCommand({ Bucket: env().S3_BUCKET, Key: key }))
    .then(() => true, () => false);
const scan = (agencyId: string, key: string) => scanLogo(agencyId, key, { host: "127.0.0.1", port });
const agencyRow = async (subdomain: string) => (await publicAgencyBySubdomain(subdomain))!;

beforeAll(async () => {
  await s3().send(new CreateBucketCommand({ Bucket: env().S3_BUCKET })).catch(() => undefined);
  clamd = createServer((socket) => {
    const parts: Buffer[] = [];
    socket.on("data", (d) => {
      parts.push(d);
      const all = Buffer.concat(parts);
      if (all.length >= 14 && all.subarray(all.length - 4).readUInt32BE() === 0) {
        socket.end(all.toString("latin1").includes("EICAR-STANDARD") ? "stream: Eicar FOUND\0" : "stream: OK\0");
      }
    });
  });
  await new Promise<void>((r) => clamd.listen(0, "127.0.0.1", () => r()));
  port = (clamd.address() as { port: number }).port;
  a = await createAgencyWithAdmin("LogoA");
  b = await createAgencyWithAdmin("LogoB");
  adminA = { ctx: { agencyId: a.agency.id, userId: a.admin.id }, role: "admin", userId: a.admin.id };
  adminB = { ctx: { agencyId: b.agency.id, userId: b.admin.id }, role: "admin", userId: b.admin.id };
});
afterAll(async () => {
  await new Promise<void>((r) => clamd.close(() => r()));
  await closeDb();
});

describe("agency logo", () => {
  it("accepts only PNG or JPG up to 1 MB, from admins", async () => {
    await expect(uploadLogo(adminA, Buffer.from("%PDF-1.4"))).rejects.toBeInstanceOf(LogoRejectedError);
    await expect(uploadLogo(adminA, Buffer.from("<svg onload=alert(1)>"))).rejects.toBeInstanceOf(LogoRejectedError);
    await expect(uploadLogo(adminA, Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]))).rejects.toBeInstanceOf(LogoRejectedError);
    const agentId = await inviteStaff(adminA.ctx, { name: "Logo Agent", email: `logo-${Date.now()}@a.test`, role: "agent", phone: null });
    await expect(uploadLogo({ ctx: { agencyId: a.agency.id, userId: agentId }, role: "agent", userId: agentId }, PNG)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("becomes the agency's logo only after a clean scan, replacing the old one", async () => {
    const first = await uploadLogo(adminA, PNG);
    expect((await agencyRow(a.agency.subdomain)).logo_key).toBeNull();
    expect(await scan(a.agency.id, first)).toBe("clean");
    const firstClean = (await agencyRow(a.agency.subdomain)).logo_key!;
    expect(firstClean).toBe(first.replace("/quarantine/", "/files/"));
    expect((await logoFile(await agencyRow(a.agency.subdomain)))?.contentType).toBe("image/png");

    const second = await uploadLogo(adminA, PNG);
    await scan(a.agency.id, second);
    expect((await agencyRow(a.agency.subdomain)).logo_key).toBe(second.replace("/quarantine/", "/files/"));
    expect(await exists(firstClean)).toBe(false);
  });

  it("deletes an infected logo and keeps the current one", async () => {
    const current = (await agencyRow(a.agency.subdomain)).logo_key;
    const bad = await uploadLogo(adminA, EICAR_PNG);
    expect(await scan(a.agency.id, bad)).toBe("infected");
    expect(await exists(bad)).toBe(false);
    expect((await agencyRow(a.agency.subdomain)).logo_key).toBe(current);
  });

  it("cannot be applied to, or served for, another agency", async () => {
    const mine = await uploadLogo(adminB, PNG);
    // Agency A's job cannot install agency B's upload
    expect(await scan(a.agency.id, mine)).toBe("skipped");
    expect((await agencyRow(b.agency.subdomain)).logo_key).toBeNull();
    // A logo key outside the agency's prefix is never read
    const aKey = (await agencyRow(a.agency.subdomain)).logo_key!;
    await expect(logoFile({ id: b.agency.id, logo_key: aKey })).rejects.toBeInstanceOf(StorageAccessError);
  });

  it("can be removed", async () => {
    const key = (await agencyRow(a.agency.subdomain)).logo_key!;
    await removeLogo(adminA);
    expect((await agencyRow(a.agency.subdomain)).logo_key).toBeNull();
    expect(await exists(key)).toBe(false);
  });
});
