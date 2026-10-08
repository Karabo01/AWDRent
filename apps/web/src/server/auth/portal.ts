import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "@awdrent/config";
import { parseHost } from "@awdrent/core/hosts";
import { ensurePortalUser, findSignInTarget, parseSignInIdentifier, sendSignInCode } from "@awdrent/core/portal";
import { authDb, publicAgencyBySubdomain, schema } from "@awdrent/db";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { redisRateLimitStorage } from "../redis";
import { authBaseOptions, hostOf } from "./shared";

// Tenant portal sign-in (D41, D76): no passwords. The tenant gives the email
// address or mobile number the agency has for them and receives a 6-digit
// code by that route. Served at {agency}.awdrent.co.za/api/portal-auth/*.
//
//   - The agency comes from the host; the tenant is looked up within it only.
//   - Codes last 10 minutes and allow 5 tries; only a keyed hash is stored.
//   - At most 3 codes per address per 15 minutes (SMS costs money), on top of
//     per-IP rate limits.
//   - The answer to "send me a code" is the same whether or not the address
//     belongs to a tenant, so it cannot be used to find out who rents.

const CODE_TTL_MS = 10 * 60_000;
const MAX_TRIES = 5;
const SEND_WINDOW_MS = 15 * 60_000;
// 3 with the production rate limit (5); end-to-end runs raise AUTH_RATE_LIMIT_MAX and get more
const maxSends = () => Math.max(3, Math.floor(env().AUTH_RATE_LIMIT_MAX / 2));

interface StoredCode {
  /** HMAC of the code */
  h: string;
  /** Wrong tries so far */
  a: number;
  /** Codes sent in the current window, and when it started */
  n: number;
  f: number;
  tenantId: string;
}

const hashCode = (key: string, code: string) => createHmac("sha256", env().PORTAL_AUTH_SECRET).update(`${key}:${code}`).digest("base64url");

async function agencyOfRequest(ctx: { headers?: Headers; request?: Request }) {
  const host = parseHost(hostOf(ctx));
  if (host.kind !== "agency") return null;
  const agency = await publicAgencyBySubdomain(host.subdomain);
  return agency?.status === "active" ? agency : null;
}

const WRONG_CODE = "That code is not right or has expired. Check it, or ask for a new one.";

function portalOtp() {
  return {
    id: "portal-otp",
    endpoints: {
      sendPortalCode: createAuthEndpoint(
        "/otp/send",
        { method: "POST", body: z.object({ identifier: z.string().max(254) }) },
        async (ctx) => {
          const agency = await agencyOfRequest(ctx);
          const id = parseSignInIdentifier(ctx.body.identifier);
          if (!agency) throw new APIError("NOT_FOUND");
          if (!id) throw new APIError("BAD_REQUEST", { message: "Enter the email address or mobile number your agent has for you." });
          const done = ctx.json({ ok: true });
          const target = await findSignInTarget(agency.id, id);
          if (!target) return done;
          const key = `portal-otp:${agency.id}:${id.kind}:${id.value}`;
          const existing = await ctx.context.internalAdapter.findVerificationValue(key);
          const previous = existing ? (JSON.parse(existing.value) as StoredCode) : null;
          const inWindow = previous && Date.now() - previous.f < SEND_WINDOW_MS;
          if (inWindow && previous.n >= maxSends()) return done;
          const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
          const stored: StoredCode = { h: hashCode(key, code), a: 0, n: inWindow ? previous.n + 1 : 1, f: inWindow ? previous.f : Date.now(), tenantId: target.tenantId };
          await ctx.context.internalAdapter.deleteVerificationByIdentifier(key);
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: key,
            value: JSON.stringify(stored),
            // Kept for the send window, so the send limit survives the code's expiry
            expiresAt: new Date(Math.max(Date.now() + CODE_TTL_MS, stored.f + SEND_WINDOW_MS)),
          });
          try {
            await sendSignInCode(agency.id, target, code);
          } catch (err) {
            console.error("[portal] could not send a sign-in code", err);
            throw new APIError("SERVICE_UNAVAILABLE", { message: "We could not send the code just now. Please try again in a few minutes." });
          }
          return done;
        },
      ),
      verifyPortalCode: createAuthEndpoint(
        "/otp/verify",
        { method: "POST", body: z.object({ identifier: z.string().max(254), code: z.string().trim().max(10) }) },
        async (ctx) => {
          const agency = await agencyOfRequest(ctx);
          const id = parseSignInIdentifier(ctx.body.identifier);
          if (!agency) throw new APIError("NOT_FOUND");
          if (!id || !/^\d{6}$/.test(ctx.body.code)) throw new APIError("BAD_REQUEST", { message: WRONG_CODE });
          const key = `portal-otp:${agency.id}:${id.kind}:${id.value}`;
          const record = await ctx.context.internalAdapter.findVerificationValue(key);
          if (!record) throw new APIError("BAD_REQUEST", { message: WRONG_CODE });
          const stored = JSON.parse(record.value) as StoredCode;
          // The record outlives the code (send limit); the code itself lasts 10 minutes from when it was made
          const codeExpired = Date.now() > new Date(record.createdAt).getTime() + CODE_TTL_MS;
          if (codeExpired || stored.a >= MAX_TRIES) {
            throw new APIError("BAD_REQUEST", { message: stored.a >= MAX_TRIES ? "Too many tries. Ask for a new code." : WRONG_CODE });
          }
          const expected = Buffer.from(stored.h);
          const given = Buffer.from(hashCode(key, ctx.body.code));
          if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
            await ctx.context.internalAdapter.updateVerificationByIdentifier(key, { value: JSON.stringify({ ...stored, a: stored.a + 1 }) });
            throw new APIError("BAD_REQUEST", { message: stored.a + 1 >= MAX_TRIES ? "Too many tries. Ask for a new code." : WRONG_CODE });
          }
          // Single use, even if two requests race
          if (!(await ctx.context.internalAdapter.consumeVerificationValue(key))) throw new APIError("BAD_REQUEST", { message: WRONG_CODE });
          let userId: string;
          try {
            userId = await ensurePortalUser(agency.id, stored.tenantId);
          } catch {
            throw new APIError("UNAUTHORIZED", { message: "Your portal access is not available. Please contact your agent." });
          }
          const session = await ctx.context.internalAdapter.createSession(userId);
          const user = await ctx.context.internalAdapter.findUserById(userId);
          if (!session || !user) throw new APIError("INTERNAL_SERVER_ERROR");
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ ok: true });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}

async function portalLoginTarget(userId: string) {
  const [row] = await authDb()
    .select({
      agencyId: schema.portalUsers.agencyId,
      active: schema.portalUsers.active,
      subdomain: schema.agencies.subdomain,
      agencyStatus: schema.agencies.status,
    })
    .from(schema.portalUsers)
    .innerJoin(schema.agencies, eq(schema.agencies.id, schema.portalUsers.agencyId))
    .where(eq(schema.portalUsers.id, userId));
  return row;
}

function buildPortalAuth() {
  const e = env();
  return betterAuth({
    ...authBaseOptions({ secret: e.PORTAL_AUTH_SECRET, basePath: "/api/portal-auth", cookiePrefix: "awdt" }),
    database: drizzleAdapter(authDb(), {
      provider: "pg",
      schema: { user: schema.portalUsers, session: schema.portalSessions, account: schema.portalAccounts, verification: schema.portalVerifications },
    }),
    user: {
      additionalFields: {
        agencyId: { type: "string", input: false, required: true },
        tenantId: { type: "string", input: false, required: true },
        active: { type: "boolean", input: false, required: true },
      },
    },
    session: {
      // A week, renewed daily while in use
      expiresIn: 7 * 24 * 3600,
      updateAge: 24 * 3600,
      additionalFields: { agencyId: { type: "string", input: false, required: true } },
    },
    databaseHooks: {
      session: {
        create: {
          async before(session, ctx) {
            const host = parseHost(hostOf(ctx));
            const target = await portalLoginTarget(session.userId);
            if (!target || host.kind !== "agency" || target.subdomain !== host.subdomain || !target.active || target.agencyStatus !== "active") {
              throw new APIError("UNAUTHORIZED", { message: "Your portal access is not available. Please contact your agent." });
            }
            return { data: { ...session, agencyId: target.agencyId } };
          },
        },
      },
    },
    plugins: [portalOtp(), nextCookies()],
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: {
        "/otp/send": { window: 300, max: e.AUTH_RATE_LIMIT_MAX },
        "/otp/verify": { window: 300, max: e.AUTH_RATE_LIMIT_MAX * 2 },
      },
      ...(e.RATE_LIMIT_STORAGE === "redis" ? { customStorage: redisRateLimitStorage } : { storage: "memory" as const }),
    },
  });
}

let instance: ReturnType<typeof buildPortalAuth> | undefined;
export function portalAuth() {
  instance ??= buildPortalAuth();
  return instance;
}
