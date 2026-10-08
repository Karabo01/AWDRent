"use client";

import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Same-origin clients: agency pages talk to /api/auth, the platform console to
// /api/platform-auth. The proxy refuses either on the wrong kind of host.

export const staffClient = createAuthClient({ basePath: "/api/auth", plugins: [twoFactorClient()] });
export const platformClient = createAuthClient({ basePath: "/api/platform-auth", plugins: [twoFactorClient()] });

export type AuthAudience = "staff" | "platform";

export function authClient(audience: AuthAudience) {
  return audience === "staff" ? staffClient : platformClient;
}
