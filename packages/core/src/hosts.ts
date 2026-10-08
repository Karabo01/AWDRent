import { env } from "@awdrent/config";

// Which part of the platform a request is for, from its Host header.
//   admin.{base}      → the platform console
//   {sub}.{base}      → an agency
//   anything else     → unknown (404)
// The Host header alone never grants access: a staff session is only valid on
// the host of its own agency, and cookies are host-only.

export type HostKind = { kind: "platform" } | { kind: "agency"; subdomain: string } | { kind: "unknown" };

export const PLATFORM_SUBDOMAIN = "admin";
const SUBDOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;

/** Reads only APP_BASE_DOMAIN, so the proxy does not need the full environment. */
function configuredBaseDomain(): string {
  const value = process.env.APP_BASE_DOMAIN;
  if (!value) throw new Error("APP_BASE_DOMAIN is not set");
  return value;
}

export function parseHost(host: string | null | undefined, baseDomain = configuredBaseDomain()): HostKind {
  if (!host) return { kind: "unknown" };
  const name = host.toLowerCase().replace(/:\d+$/, "");
  const suffix = `.${baseDomain.toLowerCase()}`;
  if (!name.endsWith(suffix)) return { kind: "unknown" };
  const sub = name.slice(0, -suffix.length);
  if (sub === PLATFORM_SUBDOMAIN) return { kind: "platform" };
  if (!SUBDOMAIN_RE.test(sub)) return { kind: "unknown" };
  return { kind: "agency", subdomain: sub };
}

function origin(sub: string): string {
  const e = env();
  const port = e.APP_PUBLIC_PORT ? `:${e.APP_PUBLIC_PORT}` : "";
  return `${e.APP_PROTOCOL}://${sub}.${e.APP_BASE_DOMAIN}${port}`;
}

export const agencyOrigin = (subdomain: string) => origin(subdomain);
export const platformOrigin = () => origin(PLATFORM_SUBDOMAIN);
