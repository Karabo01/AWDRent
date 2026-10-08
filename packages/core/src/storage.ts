import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { env } from "@awdrent/config";

// Every object lives under agencies/{agencyId}/. New uploads land in
// quarantine/ and move to files/ only after a clean virus scan. Signed links
// are only ever issued for files/ keys of the requester's own agency.

export const SIGNED_URL_TTL_SECONDS = 300;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const KEY_RE = new RegExp(`^agencies/(${UUID})/(quarantine|files)/(${UUID})(\\.[a-z0-9]{1,5})?$`);

export type StorageArea = "quarantine" | "files";

export interface ParsedKey {
  agencyId: string;
  area: StorageArea;
  objectId: string;
}

export function parseKey(key: string): ParsedKey | null {
  const m = KEY_RE.exec(key);
  if (!m) return null;
  return { agencyId: m[1]!, area: m[2] as StorageArea, objectId: m[3]! };
}

export function newQuarantineKey(agencyId: string, extension: string): string {
  return buildKey(agencyId, "quarantine", randomUUID(), extension);
}

/** The key a quarantined file moves to once it scans clean. */
export function cleanKeyFor(quarantineKey: string): string {
  const parsed = parseKey(quarantineKey);
  if (!parsed || parsed.area !== "quarantine") throw new Error("not a quarantine key");
  return quarantineKey.replace("/quarantine/", "/files/");
}

function buildKey(agencyId: string, area: StorageArea, objectId: string, extension: string): string {
  const key = `agencies/${agencyId.toLowerCase()}/${area}/${objectId}${extension ? `.${extension}` : ""}`;
  if (!parseKey(key)) throw new Error("invalid storage key");
  return key;
}

/** Throws unless the key is a scanned file belonging to this agency. */
export function assertDownloadable(key: string, agencyId: string): void {
  const parsed = parseKey(key);
  if (!parsed || parsed.agencyId !== agencyId.toLowerCase() || parsed.area !== "files") {
    throw new StorageAccessError();
  }
}

export class StorageAccessError extends Error {
  constructor() {
    super("file not available");
    this.name = "StorageAccessError";
  }
}

let internal: S3Client | undefined;
let presigner: S3Client | undefined;

function clients() {
  if (!internal || !presigner) {
    const e = env();
    const base = {
      region: e.S3_REGION,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY },
    };
    internal = new S3Client({ ...base, endpoint: e.S3_ENDPOINT });
    // Signed URLs must carry the hostname the browser can reach
    presigner = new S3Client({ ...base, endpoint: e.S3_PUBLIC_ENDPOINT });
  }
  return { internal, presigner, bucket: env().S3_BUCKET };
}

export async function putQuarantined(agencyId: string, body: Uint8Array, contentType: string, extension: string) {
  if (body.byteLength > MAX_UPLOAD_BYTES) throw new Error("file too large");
  const key = newQuarantineKey(agencyId, extension);
  const { internal: s3, bucket } = clients();
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  return key;
}

/**
 * Stores a file the platform generated itself (receipts, statements, leases)
 * directly in the agency's files area: it needs no virus scan.
 */
export async function putGenerated(agencyId: string, body: Uint8Array, contentType: string, extension: string): Promise<string> {
  const key = buildKey(agencyId, "files", randomUUID(), extension);
  const { internal: s3, bucket } = clients();
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  return key;
}

export async function readObject(key: string): Promise<Uint8Array> {
  const { internal: s3, bucket } = clients();
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!res.Body) throw new Error("empty object");
  return res.Body.transformToByteArray();
}

/** Moves a clean file out of quarantine; returns its new key. */
export async function promote(quarantineKey: string): Promise<string> {
  const target = cleanKeyFor(quarantineKey);
  const { internal: s3, bucket } = clients();
  await s3.send(new CopyObjectCommand({ Bucket: bucket, Key: target, CopySource: `${bucket}/${quarantineKey}` }));
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: quarantineKey }));
  return target;
}

export async function deleteObject(key: string): Promise<void> {
  if (!parseKey(key)) throw new Error("invalid storage key");
  const { internal: s3, bucket } = clients();
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/**
 * Short-lived download link. The caller must already have loaded the document
 * row through withAgency() (so RLS confirmed it); this re-checks the key's
 * agency as a second line of defence.
 */
export async function signedDownloadUrl(key: string, agencyId: string, downloadName: string): Promise<string> {
  assertDownloadable(key, agencyId);
  const { presigner: s3, bucket } = clients();
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${downloadName.replace(/["\\\r\n]/g, "_")}"`,
    }),
    { expiresIn: SIGNED_URL_TTL_SECONDS },
  );
}
