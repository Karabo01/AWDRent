import "server-only";
import { env } from "@awdrent/config";
import { sendEmail } from "@awdrent/core/email";
import { agencyOrigin, parseHost } from "@awdrent/core/hosts";
import { authDb, schema } from "@awdrent/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { generateRandomString } from "better-auth/crypto";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { redisRateLimitStorage } from "../redis";
import { authBaseOptions, hostOf } from "./shared";

// Staff login: email + password, then TOTP. Served at
// {agency}.awdrent.co.za/api/auth/*. A session is only ever created on the
// host of the user's own agency, and only for active staff of an active agency.

const INVITE_TTL_SECONDS = 72 * 3600;

async function staffLoginTarget(userId: string) {
  const [row] = await authDb()
    .select({
      agencyId: schema.users.agencyId,
      active: schema.users.active,
      email: schema.users.email,
      name: schema.users.name,
      subdomain: schema.agencies.subdomain,
      agencyStatus: schema.agencies.status,
    })
    .from(schema.users)
    .innerJoin(schema.agencies, eq(schema.agencies.id, schema.users.agencyId))
    .where(eq(schema.users.id, userId));
  return row;
}

function buildStaffAuth() {
  const e = env();
  return betterAuth({
    ...authBaseOptions({ secret: e.BETTER_AUTH_SECRET, basePath: "/api/auth", cookiePrefix: "awd" }),
    database: drizzleAdapter(authDb(), {
      provider: "pg",
      schema: {
        user: schema.users,
        session: schema.authSessions,
        account: schema.authAccounts,
        verification: schema.authVerifications,
        twoFactor: schema.authTwoFactors,
      },
    }),
    user: {
      additionalFields: {
        agencyId: { type: "string", input: false, required: true },
        role: { type: "string", input: false, required: true },
        active: { type: "boolean", input: false, required: true },
      },
    },
    session: {
      expiresIn: 12 * 3600,
      updateAge: 3600,
      additionalFields: { agencyId: { type: "string", input: false, required: true } },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 3600,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, token }) {
        const target = await staffLoginTarget(user.id);
        if (!target) return;
        await sendEmail({
          to: target.email,
          subject: "Reset your AWDRent password",
          text: `Hi ${target.name},\n\nUse this link within an hour to choose a new password:\n${agencyOrigin(target.subdomain)}/reset-password?token=${encodeURIComponent(token)}\n\nIf you did not ask for this, ignore this email.`,
        });
      },
    },
    databaseHooks: {
      session: {
        create: {
          async before(session, ctx) {
            const host = parseHost(hostOf(ctx));
            const target = await staffLoginTarget(session.userId);
            // Same message as a wrong password, so this reveals nothing
            if (
              !target ||
              host.kind !== "agency" ||
              target.subdomain !== host.subdomain ||
              !target.active ||
              target.agencyStatus !== "active"
            ) {
              throw new APIError("UNAUTHORIZED", { message: "Invalid email or password" });
            }
            return { data: { ...session, agencyId: target.agencyId } };
          },
          async after(session) {
            await authDb()
              .update(schema.users)
              .set({ lastLoginAt: new Date() })
              .where(eq(schema.users.id, session.userId));
          },
        },
      },
    },
    plugins: [
      twoFactor({
        issuer: "AWDRent",
        twoFactorTable: "twoFactor",
        backupCodeOptions: { amount: 8 },
        accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 900 },
      }),
      nextCookies(),
    ],
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 300, max: 5 },
        "/two-factor/verify-totp": { window: 300, max: 5 },
        "/two-factor/verify-backup-code": { window: 300, max: 5 },
        "/request-password-reset": { window: 3600, max: 3 },
        "/reset-password": { window: 3600, max: 5 },
      },
      ...(e.RATE_LIMIT_STORAGE === "redis" ? { customStorage: redisRateLimitStorage } : { storage: "memory" as const }),
    },
  });
}

let instance: ReturnType<typeof buildStaffAuth> | undefined;
export function staffAuth() {
  instance ??= buildStaffAuth();
  return instance;
}

/**
 * Emails a new staff member a link to set their password (valid 72 hours).
 * Reuses Better Auth's reset-password verification, so the same page serves both.
 */
export async function sendStaffInvite(userId: string): Promise<void> {
  const target = await staffLoginTarget(userId);
  if (!target) throw new Error("user not found");
  const ctx = await staffAuth().$context;
  const token = generateRandomString(32);
  await ctx.internalAdapter.createVerificationValue({
    identifier: `reset-password:${token}`,
    value: userId,
    expiresAt: new Date(Date.now() + INVITE_TTL_SECONDS * 1000),
  });
  await sendEmail({
    to: target.email,
    subject: "You've been invited to AWDRent",
    text: `Hi ${target.name},\n\nAn account has been created for you. Set your password within 72 hours:\n${agencyOrigin(target.subdomain)}/reset-password?token=${encodeURIComponent(token)}\n\nYou will then set up two-factor authentication with an authenticator app.`,
  });
}

/** Signs a deactivated user out everywhere. */
export async function revokeStaffSessions(userId: string): Promise<void> {
  const ctx = await staffAuth().$context;
  await ctx.internalAdapter.deleteUserSessions(userId);
}
