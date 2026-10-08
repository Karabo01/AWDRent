import "server-only";
import { env } from "@awdrent/config";
import { parseHost } from "@awdrent/core/hosts";
import { createAuthMiddleware } from "better-auth/api";

/** Host header of the request behind a Better Auth hook. */
export function hostOf(ctx: { headers?: Headers; request?: Request } | null | undefined): string | null {
  return ctx?.headers?.get("host") ?? ctx?.request?.headers.get("host") ?? null;
}

// Endpoints neither instance exposes. Accounts are created by admins, not by
// sign-up; profile and email changes go through audited app screens; 2FA is
// mandatory so it cannot be switched off.
const DISABLED_PATHS = [
  "/sign-up/email",
  "/update-user",
  "/change-email",
  "/delete-user",
  "/send-verification-email",
  "/verify-email",
  "/link-social",
  "/unlink-account",
  "/two-factor/disable",
];

export function authBaseOptions(opts: { secret: string; basePath: string; cookiePrefix: string }) {
  const e = env();
  const port = e.APP_PUBLIC_PORT ? `:${e.APP_PUBLIC_PORT}` : "";
  return {
    secret: opts.secret,
    basePath: opts.basePath,
    baseURL: {
      allowedHosts: [`*.${e.APP_BASE_DOMAIN}`, `*.${e.APP_BASE_DOMAIN}${port}`],
      protocol: e.APP_PROTOCOL,
    },
    // Only the exact origin of a recognised host may call the auth endpoints
    trustedOrigins: (request?: Request) => {
      const host = request?.headers.get("host");
      if (!host || parseHost(host).kind === "unknown") return [];
      return [`${e.APP_PROTOCOL}://${host}`];
    },
    disabledPaths: DISABLED_PATHS,
    telemetry: { enabled: false },
    advanced: {
      cookiePrefix: opts.cookiePrefix,
      useSecureCookies: e.APP_PROTOCOL === "https",
      // No Domain attribute: cookies stay on the exact host that set them
      defaultCookieAttributes: { sameSite: "lax" as const, httpOnly: true },
      database: { generateId: "uuid" as const },
    },
    hooks: {
      // "Trust this device" would skip TOTP for 30 days; staff 2FA is mandatory
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path.startsWith("/two-factor/verify") && ctx.body && typeof ctx.body === "object") {
          return { context: { body: { ...ctx.body, trustDevice: false } } };
        }
      }),
    },
  };
}
