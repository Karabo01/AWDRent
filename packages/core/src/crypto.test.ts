import { randomBytes } from "node:crypto";
import { resetEnvCache } from "@awdrent/config";
import { beforeEach, describe, expect, it } from "vitest";
import { blindIndex, decrypt, encrypt, last4, mask, needsRotation } from "./crypto";

const k1 = randomBytes(32).toString("base64");
const k2 = randomBytes(32).toString("base64");
const A = { agencyId: "11111111-1111-4111-8111-111111111111", field: "tenants.id_number" };
const B = { agencyId: "22222222-2222-4222-8222-222222222222", field: "tenants.id_number" };

function setKeys(keys: string, active: number) {
  Object.assign(process.env, {
    APP_BASE_DOMAIN: "localhost",
    DATABASE_URL: "postgres://x@localhost/x",
    DATABASE_AUTH_URL: "postgres://x@localhost/x",
    DATABASE_PLATFORM_URL: "postgres://x@localhost/x",
    REDIS_URL: "redis://localhost:6379",
    S3_ENDPOINT: "http://localhost:9000",
    S3_PUBLIC_ENDPOINT: "http://localhost:9000",
    S3_ACCESS_KEY_ID: "x",
    S3_SECRET_ACCESS_KEY: "x",
    S3_BUCKET: "x",
    CLAMAV_HOST: "localhost",
    BETTER_AUTH_SECRET: "x".repeat(32),
    PLATFORM_AUTH_SECRET: "y".repeat(32),
    BLIND_INDEX_KEY: k1,
    ENCRYPTION_KEYS: keys,
    ENCRYPTION_ACTIVE_KEY_VERSION: String(active),
  });
  resetEnvCache();
}

beforeEach(() => setKeys(`1:${k1}`, 1));

describe("encrypt/decrypt", () => {
  it("round-trips and never stores the plaintext", () => {
    const stored = encrypt("8001015009087", A);
    expect(stored).toMatch(/^v1:/);
    expect(stored).not.toContain("8001015009087");
    expect(decrypt(stored, A)).toBe("8001015009087");
  });

  it("uses a fresh IV each time", () => {
    expect(encrypt("same", A)).not.toBe(encrypt("same", A));
  });

  it("refuses a ciphertext moved to another agency", () => {
    expect(() => decrypt(encrypt("8001015009087", A), B)).toThrow();
  });

  it("refuses a ciphertext moved to another field", () => {
    expect(() => decrypt(encrypt("123", A), { ...A, field: "owners.account_no" })).toThrow();
  });

  it("detects tampering", () => {
    const stored = encrypt("8001015009087", A);
    const blob = Buffer.from(stored.slice(3), "base64");
    blob[14] = (blob[14] ?? 0) ^ 1;
    expect(() => decrypt(`v1:${blob.toString("base64")}`, A)).toThrow();
  });

  it("decrypts old-key values after rotation and flags them", () => {
    const old = encrypt("62001234567", A);
    setKeys(`1:${k1},2:${k2}`, 2);
    expect(decrypt(old, A)).toBe("62001234567");
    expect(needsRotation(old)).toBe(true);
    const fresh = encrypt("62001234567", A);
    expect(fresh).toMatch(/^v2:/);
    expect(needsRotation(fresh)).toBe(false);
  });

  it("fails clearly when a key version is missing", () => {
    const stored = encrypt("x", A);
    setKeys(`2:${k2}`, 2);
    expect(() => decrypt(stored, A)).toThrow(/v1 is not configured/);
  });
});

describe("blind index", () => {
  it("matches regardless of spacing", () => {
    expect(blindIndex("8001 0150 0908 7", A)).toBe(blindIndex("8001015009087", A));
  });

  it("differs between agencies", () => {
    expect(blindIndex("8001015009087", A)).not.toBe(blindIndex("8001015009087", B));
  });
});

describe("masking", () => {
  it("shows only the last four", () => {
    expect(last4("62 0012 3456 7")).toBe("4567");
    expect(mask("4567")).toBe("•••• 4567");
    expect(mask(null)).toBe("—");
  });
});
