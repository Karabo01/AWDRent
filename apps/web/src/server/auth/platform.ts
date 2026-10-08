import "server-only";
import { env } from "@awdrent/config";
import { parseHost } from "@awdrent/core/hosts";
import { authDb, schema } from "@awdrent/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { redisRateLimitStorage } from "../redis";
import { authBaseOptions, hostOf } from "./shared";

// AWDTECH platform admins: a separate Better Auth instance with its own
// tables, secret and cookie, served only at admin.awdrent.co.za/api/platform-auth/*.
// Admins are created from the CLI (npm run platform:create-admin).

function buildPlatformAuth() {
  const e = env();
  return betterAuth({
    ...authBaseOptions({ secret: e.PLATFORM_AUTH_SECRET, basePath: "/api/platform-auth", cookiePrefix: "awdp" }),
    database: drizzleAdapter(authDb(), {
      provider: "pg",
      schema: {
        user: schema.platformAdmins,
        session: schema.platformSessions,
        account: schema.platformAccounts,
        verification: schema.platformVerifications,
        twoFactor: schema.platformTwoFactors,
      },
    }),
    session: { expiresIn: 8 * 3600, updateAge: 3600 },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 14,
      maxPasswordLength: 128,
    },
    databaseHooks: {
      session: {
        create: {
          async before(session, ctx) {
            if (parseHost(hostOf(ctx)).kind !== "platform") {
              throw new APIError("UNAUTHORIZED", { message: "Invalid email or password" });
            }
            return { data: session };
          },
          async after(session) {
            await authDb()
              .update(schema.platformAdmins)
              .set({ lastLoginAt: new Date() })
              .where(eq(schema.platformAdmins.id, session.userId));
          },
        },
      },
    },
    plugins: [
      twoFactor({
        issuer: "AWDRent Platform",
        twoFactorTable: "twoFactor",
        backupCodeOptions: { amount: 8 },
        accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 1800 },
      }),
      nextCookies(),
    ],
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 300, max: e.AUTH_RATE_LIMIT_MAX },
        "/two-factor/verify-totp": { window: 300, max: e.AUTH_RATE_LIMIT_MAX },
        "/two-factor/verify-backup-code": { window: 300, max: e.AUTH_RATE_LIMIT_MAX },
      },
      ...(e.RATE_LIMIT_STORAGE === "redis" ? { customStorage: redisRateLimitStorage } : { storage: "memory" as const }),
    },
  });
}

let instance: ReturnType<typeof buildPlatformAuth> | undefined;
export function platformAuth() {
  instance ??= buildPlatformAuth();
  return instance;
}
