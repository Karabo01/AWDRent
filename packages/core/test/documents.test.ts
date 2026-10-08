import { createServer, type Server } from "node:net";
import { CreateBucketCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@awdrent/config";
import { closeDb, schema, withAgency } from "@awdrent/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgencyWithAdmin } from "../../db/test/fixtures";
import { deleteDocument, documentDownloadUrl, listDocuments, scanDocument, UploadRejectedError, uploadDocument } from "../src/documents";
import { ForbiddenError } from "../src/permissions";
import { type Actor, NotFoundError } from "../src/portfolio";
import { inviteStaff } from "../src/staff";
import { signedDownloadUrl, StorageAccessError } from "../src/storage";
import { createTenant, type TenantInput } from "../src/tenants";

// Runs against the real S3-compatible store in .env (docker compose locally
// and in CI) with a fake clamd, so infected/clean outcomes are deterministic.

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const EICAR_PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*")]);

let clamd: Server;
let clamdPort = 0;
let a: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let b: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let adminA: Actor;
let adminB: Actor;
let agentA: Actor;
let accountsA: Actor;
let tenantA: string;

const tenant = (fullName: string): TenantInput => ({
  fullName,
  idKind: "sa_id",
  idNumber: "",
  email: null,
  phone: null,
  employer: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  consentGiven: true,
  emailOptIn: false,
  smsOptIn: false,
  whatsappOptIn: false,
  notes: null,
});

const s3 = () =>
  new S3Client({
    endpoint: env().S3_ENDPOINT,
    region: env().S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env().S3_ACCESS_KEY_ID, secretAccessKey: env().S3_SECRET_ACCESS_KEY },
  });

async function exists(key: string): Promise<boolean> {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: env().S3_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function docRow(actor: Actor, id: string) {
  const [d] = await withAgency(actor.ctx, (tx) => tx.select().from(schema.documents).where(eq(schema.documents.id, id)));
  return d!;
}

beforeAll(async () => {
  await s3()
    .send(new CreateBucketCommand({ Bucket: env().S3_BUCKET }))
    .catch(() => undefined);
  clamd = createServer((socket) => {
    const parts: Buffer[] = [];
    socket.on("data", (d) => {
      parts.push(d);
      const all = Buffer.concat(parts);
      if (all.length >= 14 && all.subarray(all.length - 4).readUInt32BE() === 0) {
        socket.end(all.toString("latin1").includes("EICAR-STANDARD") ? "stream: Eicar-Signature FOUND\0" : "stream: OK\0");
      }
    });
  });
  await new Promise<void>((r) => clamd.listen(0, "127.0.0.1", () => r()));
  clamdPort = (clamd.address() as { port: number }).port;

  a = await createAgencyWithAdmin("DocA");
  b = await createAgencyWithAdmin("DocB");
  adminA = { ctx: { agencyId: a.agency.id, userId: a.admin.id }, role: "admin", userId: a.admin.id };
  adminB = { ctx: { agencyId: b.agency.id, userId: b.admin.id }, role: "admin", userId: b.admin.id };
  const agentId = await inviteStaff(adminA.ctx, { name: "Doc Agent", email: `da-${Date.now()}@a.test`, role: "agent", phone: null });
  agentA = { ctx: { agencyId: a.agency.id, userId: agentId }, role: "agent", userId: agentId };
  const accId = await inviteStaff(adminA.ctx, { name: "Doc Acc", email: `dacc-${Date.now()}@a.test`, role: "accounts", phone: null });
  accountsA = { ctx: { agencyId: a.agency.id, userId: accId }, role: "accounts", userId: accId };
  tenantA = await createTenant(adminA, tenant("Document Tenant"));
});
afterAll(async () => {
  await new Promise<void>((r) => clamd.close(() => r()));
  await closeDb();
});

const scan = (actor: Actor, id: string) => scanDocument(actor.ctx.agencyId, id, { host: "127.0.0.1", port: clamdPort });

describe("uploads", () => {
  it("stores new files in the agency's quarantine, pending a scan", async () => {
    const id = await uploadDocument(adminA, { subject: { type: "tenant", id: tenantA }, kind: "id_document", filename: "id copy.PDF", bytes: PDF });
    const d = await docRow(adminA, id);
    expect(d).toMatchObject({ status: "pending_scan", filename: "id copy.pdf", contentType: "application/pdf", tenantId: tenantA });
    expect(d.fileKey).toMatch(new RegExp(`^agencies/${a.agency.id}/quarantine/`));
    expect(await exists(d.fileKey)).toBe(true);
    // Not downloadable until scanned
    await expect(documentDownloadUrl(adminA, id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses the wrong type, empty files and files over 10 MB", async () => {
    const subject = { type: "tenant" as const, id: tenantA };
    const up = (bytes: Uint8Array) => uploadDocument(adminA, { subject, kind: "other", filename: "x.pdf", bytes });
    await expect(up(Buffer.from("MZ\x90\x00 not a pdf"))).rejects.toBeInstanceOf(UploadRejectedError);
    await expect(up(Buffer.alloc(0))).rejects.toBeInstanceOf(UploadRejectedError);
    await expect(up(Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]))).rejects.toBeInstanceOf(UploadRejectedError);
  });

  it("does not let accounts upload", async () => {
    await expect(
      uploadDocument(accountsA, { subject: { type: "tenant", id: tenantA }, kind: "other", filename: "x.pdf", bytes: PDF }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("scanning", () => {
  it("moves a clean file out of quarantine and makes it downloadable", async () => {
    const id = await uploadDocument(adminA, { subject: { type: "tenant", id: tenantA }, kind: "payslip", filename: "slip.pdf", bytes: PDF });
    const quarantined = (await docRow(adminA, id)).fileKey;
    expect(await scan(adminA, id)).toBe("clean");
    const d = await docRow(adminA, id);
    expect(d.status).toBe("clean");
    expect(d.fileKey).toBe(quarantined.replace("/quarantine/", "/files/"));
    expect(await exists(quarantined)).toBe(false);
    const url = await documentDownloadUrl(adminA, id);
    expect(url).toContain("X-Amz-Expires=300");
    const res = await fetch(url);
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
    // Re-running the job does nothing
    expect(await scan(adminA, id)).toBe("skipped");
  });

  it("deletes an infected file and never serves it", async () => {
    const id = await uploadDocument(adminA, { subject: { type: "tenant", id: tenantA }, kind: "other", filename: "bad.pdf", bytes: EICAR_PDF });
    const key = (await docRow(adminA, id)).fileKey;
    expect(await scan(adminA, id)).toBe("infected");
    expect(await docRow(adminA, id)).toMatchObject({ status: "infected", scanResult: "Eicar-Signature" });
    expect(await exists(key)).toBe(false);
    await expect(documentDownloadUrl(adminA, id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("documents across agencies and portfolios", () => {
  let docId: string;
  beforeAll(async () => {
    docId = await uploadDocument(adminA, { subject: { type: "tenant", id: tenantA }, kind: "bank_statement", filename: "bank.pdf", bytes: PDF });
    await scan(adminA, docId);
  });

  it("hides another agency's documents and refuses their download links", async () => {
    await expect(listDocuments(adminB, { type: "tenant", id: tenantA })).rejects.toBeInstanceOf(NotFoundError);
    await expect(documentDownloadUrl(adminB, docId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteDocument(adminB, docId)).rejects.toBeInstanceOf(NotFoundError);
    // Even with the key in hand, signing is refused for another agency
    const key = (await docRow(adminA, docId)).fileKey;
    await expect(signedDownloadUrl(key, b.agency.id, "x.pdf")).rejects.toBeInstanceOf(StorageAccessError);
  });

  it("refuses to attach a document to another agency's record", async () => {
    await expect(
      uploadDocument(adminB, { subject: { type: "tenant", id: tenantA }, kind: "other", filename: "x.pdf", bytes: PDF }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const code = await withAgency(adminB.ctx, (tx) =>
      tx.insert(schema.documents).values({
        tenantId: tenantA,
        kind: "other",
        filename: "x.pdf",
        contentType: "application/pdf",
        sizeBytes: 10,
        sha256: "x",
        fileKey: `agencies/${b.agency.id}/files/x.pdf`,
      }),
    ).catch((e: { cause?: { code?: string } }) => e.cause?.code);
    expect(code).toBe("23503");
  });

  it("rejects a storage key outside the agency's prefix at the database", async () => {
    const code = await withAgency(adminA.ctx, (tx) =>
      tx.insert(schema.documents).values({
        tenantId: tenantA,
        kind: "other",
        filename: "x.pdf",
        contentType: "application/pdf",
        sizeBytes: 10,
        sha256: "x",
        fileKey: `agencies/${b.agency.id}/files/stolen.pdf`,
      }),
    ).catch((e: { cause?: { code?: string } }) => e.cause?.code);
    expect(code).toBe("23514");
  });

  it("limits agents to documents in their portfolio", async () => {
    await expect(listDocuments(agentA, { type: "tenant", id: tenantA })).rejects.toBeInstanceOf(NotFoundError);
    await expect(documentDownloadUrl(agentA, docId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lets only admins delete, and removes the file", async () => {
    await expect(deleteDocument(accountsA, docId)).rejects.toBeInstanceOf(ForbiddenError);
    const key = (await docRow(adminA, docId)).fileKey;
    await deleteDocument(adminA, docId);
    expect(await exists(key)).toBe(false);
    expect((await listDocuments(adminA, { type: "tenant", id: tenantA })).map((d) => d.id)).not.toContain(docId);
  });
});
