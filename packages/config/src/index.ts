import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

/**
 * Comma-separated `version:base64key` pairs, e.g. `1:AbC...=,2:XyZ...=`.
 * Each key must decode to exactly 32 bytes (AES-256).
 */
const encryptionKeys = z.string().transform((raw, ctx) => {
  const keys = new Map<number, Buffer>();
  for (const part of raw.split(",").map((p) => p.trim()).filter(Boolean)) {
    const [version, b64] = part.split(":");
    const v = Number(version);
    const key = Buffer.from(b64 ?? "", "base64");
    if (!Number.isInteger(v) || v < 1 || key.length !== 32) {
      ctx.addIssue({ code: "custom", message: `invalid key entry "${version}:…"` });
      return z.NEVER;
    }
    keys.set(v, key);
  }
  if (keys.size === 0) {
    ctx.addIssue({ code: "custom", message: "at least one key is required" });
    return z.NEVER;
  }
  return keys;
});

const base64Key32 = z
  .string()
  .transform((b64) => Buffer.from(b64, "base64"))
  .refine((b) => b.length === 32, "must decode to 32 bytes");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Routing: agencies live at {subdomain}.{APP_BASE_DOMAIN}, the console at admin.{APP_BASE_DOMAIN}
  APP_BASE_DOMAIN: z.string().min(1),
  APP_PROTOCOL: z.enum(["http", "https"]).default("https"),
  // Port shown in generated links; empty in production behind Traefik
  APP_PUBLIC_PORT: z.string().default(""),

  // Postgres connections, one per role (see docker/postgres/init)
  DATABASE_URL: z.url(), // awdrent_app: subject to RLS
  DATABASE_AUTH_URL: z.url(), // awdrent_auth: auth tables only
  DATABASE_PLATFORM_URL: z.url(), // awdrent_platform: agencies + platform tables only
  DATABASE_OWNER_URL: z.url().optional(), // awdrent_owner: migrations and seed only

  REDIS_URL: z.url(),
  // Login/OTP rate limits. "memory" is per-process and only for local runs
  // without Redis; production refuses it.
  RATE_LIMIT_STORAGE: z.enum(["redis", "memory"]).default("redis"),
  // Sign-in and code attempts allowed per IP per 5 minutes. Keep 5 in
  // production; the end-to-end test run raises it.
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1000).default(5),

  S3_ENDPOINT: z.url(),
  // Endpoint the browser uses for signed URLs; differs from S3_ENDPOINT inside docker
  S3_PUBLIC_ENDPOINT: z.url(),
  S3_REGION: z.string().default("af-south-1"),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_FORCE_PATH_STYLE: bool.default(true),

  CLAMAV_HOST: z.string().min(1),
  CLAMAV_PORT: z.coerce.number().int().default(3310),

  ENCRYPTION_KEYS: encryptionKeys,
  ENCRYPTION_ACTIVE_KEY_VERSION: z.coerce.number().int().min(1),
  BLIND_INDEX_KEY: base64Key32,

  BETTER_AUTH_SECRET: z.string().min(32),
  PLATFORM_AUTH_SECRET: z.string().min(32),
  // Tenant portal sessions and one-time code hashes (D76)
  PORTAL_AUTH_SECRET: z.string().min(32),

  // Without a key, messages go to the dev outbox (development and tests only)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("AWDRent <no-reply@awdrent.co.za>"),
  // Signing secret of the Resend webhook (whsec_...)
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  // One AWDTECH Clickatell account (D38)
  CLICKATELL_API_KEY: z.string().optional(),
  // Basic-auth credentials set on the Clickatell delivery-report callback
  CLICKATELL_CALLBACK_USER: z.string().optional(),
  CLICKATELL_CALLBACK_PASSWORD: z.string().optional(),
  // Tests only: absolute path of a JSON-lines file that receives messages
  // sent without provider keys (sign-in codes for the end-to-end tests).
  // Refused in production unless APP_BASE_DOMAIN is localhost.
  DEV_OUTBOX_FILE: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Parses and validates process.env once. Throws with every problem listed. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join("\n")}`);
  }
  if (!parsed.data.ENCRYPTION_KEYS.has(parsed.data.ENCRYPTION_ACTIVE_KEY_VERSION)) {
    throw new Error("Invalid environment:\n  ENCRYPTION_ACTIVE_KEY_VERSION: no key with that version");
  }
  if (parsed.data.DEV_OUTBOX_FILE && parsed.data.NODE_ENV === "production" && parsed.data.APP_BASE_DOMAIN !== "localhost") {
    throw new Error("Invalid environment:\n  DEV_OUTBOX_FILE: only for test runs on localhost");
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.RATE_LIMIT_STORAGE !== "redis") {
    throw new Error("Invalid environment:\n  RATE_LIMIT_STORAGE: must be redis in production");
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: forget the parsed env so a test can change process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}
