import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { env } from "@awdrent/config";

// Column encryption for ID numbers and bank account numbers.
//
// Stored format: "v{keyVersion}:{base64(iv | ciphertext | tag)}", AES-256-GCM.
// The agency id and field name are bound in as additional authenticated data,
// so a ciphertext copied into another row's field or another agency fails to
// decrypt instead of showing the wrong person's number.

const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface FieldContext {
  agencyId: string;
  /** Stable field name, e.g. "tenants.id_number". Changing it breaks decryption. */
  field: string;
}

function aad(ctx: FieldContext): Buffer {
  return Buffer.from(`${ctx.agencyId}|${ctx.field}`, "utf8");
}

export function encrypt(plaintext: string, ctx: FieldContext): string {
  const { ENCRYPTION_KEYS, ENCRYPTION_ACTIVE_KEY_VERSION } = env();
  const key = ENCRYPTION_KEYS.get(ENCRYPTION_ACTIVE_KEY_VERSION);
  if (!key) throw new Error("active encryption key missing");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(ctx));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const blob = Buffer.concat([iv, body, cipher.getAuthTag()]);
  return `v${ENCRYPTION_ACTIVE_KEY_VERSION}:${blob.toString("base64")}`;
}

export function decrypt(stored: string, ctx: FieldContext): string {
  const match = /^v(\d+):([A-Za-z0-9+/=]+)$/.exec(stored);
  if (!match) throw new Error("not an encrypted value");
  const key = env().ENCRYPTION_KEYS.get(Number(match[1]));
  if (!key) throw new Error(`encryption key v${match[1]} is not configured`);
  const blob = Buffer.from(match[2] ?? "", "base64");
  if (blob.length < IV_BYTES + TAG_BYTES) throw new Error("encrypted value is truncated");
  const decipher = createDecipheriv("aes-256-gcm", key, blob.subarray(0, IV_BYTES));
  decipher.setAAD(aad(ctx));
  decipher.setAuthTag(blob.subarray(blob.length - TAG_BYTES));
  return Buffer.concat([decipher.update(blob.subarray(IV_BYTES, blob.length - TAG_BYTES)), decipher.final()]).toString(
    "utf8",
  );
}

/** True when the value was encrypted with an older key and should be re-encrypted. */
export function needsRotation(stored: string): boolean {
  return !stored.startsWith(`v${env().ENCRYPTION_ACTIVE_KEY_VERSION}:`);
}

/**
 * Deterministic keyed hash for finding a record by an encrypted value
 * (e.g. duplicate ID numbers within an agency). Scoped per agency, so the
 * same ID number gives unrelated hashes in two agencies.
 */
export function blindIndex(value: string, ctx: FieldContext): string {
  return createHmac("sha256", env().BLIND_INDEX_KEY)
    .update(`${ctx.agencyId}|${ctx.field}|${normaliseIdentifier(value)}`)
    .digest("hex");
}

/** Removes spaces and dashes and upper-cases, so "8001 0150 0908 7" matches "8001015009087". */
export function normaliseIdentifier(value: string): string {
  return value.replace(/[\s-]/g, "").toUpperCase();
}

/** Last four characters for display and the *_last4 columns. */
export function last4(value: string): string {
  return normaliseIdentifier(value).slice(-4);
}

/** "•••• 0087" style mask from the stored last-4 digits. */
export function mask(lastFour: string | null | undefined): string {
  return lastFour ? `•••• ${lastFour}` : "—";
}
