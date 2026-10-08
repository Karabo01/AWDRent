import { parseHost } from "@awdrent/core/hosts";
import { type NextRequest, NextResponse } from "next/server";

// Routes each request by host:
//   {agency}.awdrent.co.za/x  →  app/agency/x
//   admin.awdrent.co.za/x     →  app/platform/x
// Auth endpoints answer only on their own kind of host; provider webhooks
// (/api/webhooks/*) only on the admin host. The internal
// /agency and /platform prefixes cannot be requested directly, so an agency
// host can never reach a platform page or the other way round.
// This is routing only; every page and action still checks the session.

const notFound = () => new NextResponse("Not found", { status: 404 });

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === "/api/health") return NextResponse.next();

  const host = parseHost(request.headers.get("host"));
  if (host.kind === "unknown") return notFound();
  if (/^\/(agency|platform)(\/|$)/.test(pathname)) return notFound();

  if (pathname.startsWith("/api/auth/")) return host.kind === "agency" ? NextResponse.next() : notFound();
  if (pathname.startsWith("/api/platform-auth/")) return host.kind === "platform" ? NextResponse.next() : notFound();
  // Provider delivery reports: one fixed URL each, on the admin host; verified in the handler
  if (pathname.startsWith("/api/webhooks/")) return host.kind === "platform" ? NextResponse.next() : notFound();

  const prefix = host.kind === "agency" ? "/agency" : "/platform";
  // The visible path, for audit entries. Always overwritten, never trusted from the client.
  const forwarded = new Headers(request.headers);
  forwarded.set("x-awd-path", pathname);
  return NextResponse.rewrite(new URL(`${prefix}${pathname === "/" ? "" : pathname}${search}`, request.url), {
    request: { headers: forwarded },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
