import { createHash } from "node:crypto";
import { type AgencyContext, schema, type Tx, withAgency } from "@awdrent/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { audit } from "./audit";
import { scanBuffer } from "./clamav";
import { cleanFilename, detectFileType } from "./file-types";
import type { Action } from "./permissions";
import {
  type Actor,
  assertLeaseInScope,
  assertOwnerInScope,
  assertPropertyInScope,
  assertTenantInScope,
  assertUnitInScope,
  authorise,
  NotFoundError,
} from "./portfolio";
import { deleteObject, MAX_UPLOAD_BYTES, promote, putQuarantined, readObject, signedDownloadUrl } from "./storage";

// Documents (decision D22): uploaded into quarantine, scanned by ClamAV in
// the worker, then moved to files/. Downloads only for clean files, through
// a 5-minute signed link, after a portfolio-scoped lookup.

export const SUBJECT_TYPES = ["owner", "property", "unit", "tenant", "lease", "maintenance_request"] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];
export const subjectSchema = z.object({ type: z.enum(SUBJECT_TYPES), id: z.uuid() });
export type Subject = z.infer<typeof subjectSchema>;

export const DOCUMENT_KINDS = schema.documentKind.enumValues;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export class UploadRejectedError extends Error {}

const SUBJECT_COLUMN = {
  owner: schema.documents.ownerId,
  property: schema.documents.propertyId,
  unit: schema.documents.unitId,
  tenant: schema.documents.tenantId,
  lease: schema.documents.leaseId,
  maintenance_request: schema.documents.maintenanceRequestId,
} as const;

const SUBJECT_KEY = {
  owner: "ownerId",
  property: "propertyId",
  unit: "unitId",
  tenant: "tenantId",
  lease: "leaseId",
  maintenance_request: "maintenanceRequestId",
} as const;

async function assertSubjectInScope(tx: Tx, actor: Actor, subject: Subject): Promise<void> {
  switch (subject.type) {
    case "owner":
      return assertOwnerInScope(tx, actor, subject.id);
    case "property":
      return assertPropertyInScope(tx, actor, subject.id);
    case "unit":
      await assertUnitInScope(tx, actor, subject.id);
      return;
    case "tenant":
      return assertTenantInScope(tx, actor, subject.id);
    case "lease":
      return assertLeaseInScope(tx, actor, subject.id);
    case "maintenance_request": {
      // In scope when its unit is
      const [r] = await tx.select({ unitId: schema.maintenanceRequests.unitId }).from(schema.maintenanceRequests).where(eq(schema.maintenanceRequests.id, subject.id));
      if (!r) throw new NotFoundError("Maintenance request");
      await assertUnitInScope(tx, actor, r.unitId);
      return;
    }
  }
}

function subjectOf(d: typeof schema.documents.$inferSelect): Subject {
  for (const type of SUBJECT_TYPES) {
    const id = d[SUBJECT_KEY[type]];
    if (id) return { type, id };
  }
  throw new Error("document has no subject");
}

export async function listDocuments(actor: Actor, subject: Subject) {
  authorise(actor, "documents.view");
  return withAgency(actor.ctx, async (tx) => {
    await assertSubjectInScope(tx, actor, subject);
    return tx
      .select({
        id: schema.documents.id,
        kind: schema.documents.kind,
        filename: schema.documents.filename,
        contentType: schema.documents.contentType,
        sizeBytes: schema.documents.sizeBytes,
        status: schema.documents.status,
        createdAt: schema.documents.createdAt,
        uploadedBy: schema.users.name,
      })
      .from(schema.documents)
      .leftJoin(schema.users, eq(schema.users.id, schema.documents.createdBy))
      .where(and(eq(SUBJECT_COLUMN[subject.type], subject.id), isNull(schema.documents.deletedAt)))
      .orderBy(desc(schema.documents.createdAt));
  });
}

/**
 * Checks and stores an upload in quarantine and records it as pending.
 * Returns the document id; the caller queues the scan.
 */
export async function uploadDocument(
  actor: Actor,
  input: { subject: Subject; kind: DocumentKind; filename: string; bytes: Uint8Array },
  permission: Action = "documents.upload",
): Promise<string> {
  authorise(actor, permission);
  return storeUpload(actor.ctx, input, (tx) => assertSubjectInScope(tx, actor, input.subject));
}

/**
 * Stores an upload in quarantine and records it as pending its virus scan.
 * `check` asserts the uploader may attach to the subject; it runs before
 * anything is stored and again in the recording transaction. Shared by staff
 * uploads and the tenant portal (D78).
 */
export async function storeUpload(
  ctx: AgencyContext,
  input: { subject: Subject; kind: DocumentKind; filename: string; bytes: Uint8Array },
  check: (tx: Tx) => Promise<void>,
): Promise<string> {
  if (input.bytes.byteLength === 0) throw new UploadRejectedError("The file is empty.");
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) throw new UploadRejectedError("Files can be at most 10 MB.");
  const type = detectFileType(input.bytes);
  if (!type) throw new UploadRejectedError("Only PDF, JPG and PNG files can be uploaded.");

  // Check access before storing anything
  await withAgency(ctx, check);
  const key = await putQuarantined(ctx.agencyId, input.bytes, type.contentType, type.extension);
  try {
    return await withAgency(ctx, async (tx) => {
      await check(tx);
      const [doc] = await tx
        .insert(schema.documents)
        .values({
          [SUBJECT_KEY[input.subject.type]]: input.subject.id,
          kind: input.kind,
          filename: cleanFilename(input.filename, type.extension),
          contentType: type.contentType,
          sizeBytes: input.bytes.byteLength,
          sha256: createHash("sha256").update(input.bytes).digest("hex"),
          fileKey: key,
        })
        .returning();
      await audit(tx, {
        action: "document.uploaded",
        entity: "document",
        entityId: doc!.id,
        after: { subject: input.subject, kind: input.kind, filename: doc!.filename, sizeBytes: doc!.sizeBytes },
      });
      return doc!.id;
    });
  } catch (err) {
    await deleteObject(key).catch(() => undefined);
    throw err;
  }
}

/**
 * Worker step: scan one quarantined document and either promote it or
 * delete the file. Safe to run twice: a document no longer pending is skipped.
 */
export async function scanDocument(
  agencyId: string,
  documentId: string,
  clamd: { host: string; port: number },
): Promise<"clean" | "infected" | "skipped"> {
  const ctx = { agencyId };
  const [doc] = await withAgency(ctx, (tx) => tx.select().from(schema.documents).where(eq(schema.documents.id, documentId)));
  if (!doc || doc.status !== "pending_scan") return "skipped";
  const result = await scanBuffer(await readObject(doc.fileKey), clamd);
  if (result.clean) {
    const cleanKey = await promote(doc.fileKey);
    await withAgency(ctx, async (tx) => {
      await tx
        .update(schema.documents)
        .set({ status: "clean", fileKey: cleanKey, scanResult: "OK", scannedAt: sql`now()` })
        .where(and(eq(schema.documents.id, documentId), eq(schema.documents.status, "pending_scan")));
    });
    return "clean";
  }
  await deleteObject(doc.fileKey);
  await withAgency(ctx, async (tx) => {
    await tx
      .update(schema.documents)
      .set({ status: "infected", scanResult: result.signature, scannedAt: sql`now()` })
      .where(eq(schema.documents.id, documentId));
    await audit(tx, { action: "document.infected", entity: "document", entityId: documentId, after: { signature: result.signature } });
  });
  return "infected";
}

/** Marks a document whose scan kept failing, so it never becomes downloadable. */
export async function markScanFailed(agencyId: string, documentId: string, reason: string): Promise<void> {
  await withAgency({ agencyId }, (tx) =>
    tx
      .update(schema.documents)
      .set({ status: "scan_failed", scanResult: reason.slice(0, 500), scannedAt: sql`now()` })
      .where(and(eq(schema.documents.id, documentId), eq(schema.documents.status, "pending_scan"))),
  );
}

/** Pending documents of one agency older than a minute (lost or delayed scan jobs). */
export async function stalePendingDocuments(agencyId: string): Promise<string[]> {
  const rows = await withAgency({ agencyId }, (tx) =>
    tx
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(and(eq(schema.documents.status, "pending_scan"), sql`${schema.documents.createdAt} < now() - interval '1 minute'`))
      .limit(100),
  );
  return rows.map((r) => r.id);
}

/** A 5-minute download link for a clean document the actor may see. Audited. */
export async function documentDownloadUrl(actor: Actor, documentId: string): Promise<string> {
  authorise(actor, "documents.view");
  const doc = await withAgency(actor.ctx, async (tx) => {
    const [d] = await tx
      .select()
      .from(schema.documents)
      .where(and(eq(schema.documents.id, documentId), isNull(schema.documents.deletedAt)));
    if (!d) throw new NotFoundError("Document");
    // An emailed file not yet tied to a lease: only those who handle POPs (D87)
    if (d.inboundEmailId) authorise(actor, "payments.approve");
    else await assertSubjectInScope(tx, actor, subjectOf(d));
    if (d.status !== "clean") throw new NotFoundError("Document");
    await audit(tx, { action: "document.downloaded", entity: "document", entityId: d.id });
    return d;
  });
  return signedDownloadUrl(doc.fileKey, actor.ctx.agencyId, doc.filename);
}

export async function deleteDocument(actor: Actor, documentId: string): Promise<void> {
  authorise(actor, "documents.delete");
  const key = await withAgency(actor.ctx, async (tx) => {
    const [d] = await tx
      .select()
      .from(schema.documents)
      .where(and(eq(schema.documents.id, documentId), isNull(schema.documents.deletedAt)))
      .for("update");
    if (!d) throw new NotFoundError("Document");
    await assertSubjectInScope(tx, actor, subjectOf(d));
    await tx.update(schema.documents).set({ deletedAt: sql`now()` }).where(eq(schema.documents.id, documentId));
    await audit(tx, { action: "document.deleted", entity: "document", entityId: documentId, before: { filename: d.filename, kind: d.kind } });
    return d.fileKey;
  });
  await deleteObject(key);
}
