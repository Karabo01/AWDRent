import { env } from "@awdrent/config";
import { agencyOrigin } from "@awdrent/core/hosts";
import { consumeEntryToken, SUPPORT_COOKIE, supportCookieValue } from "@awdrent/core/support";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentAgency } from "@/server/session";

export const dynamic = "force-dynamic";

/** Swaps a one-time entry token from the platform console for a support cookie on this host. */
export async function GET(request: Request) {
  const agency = await currentAgency();
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const session = token ? await consumeEntryToken(token, agency.id) : null;
  if (!session) return new NextResponse("This support link has expired or was already used.", { status: 403 });
  (await cookies()).set(SUPPORT_COOKIE, supportCookieValue(session.id), {
    httpOnly: true,
    secure: env().APP_PROTOCOL === "https",
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });
  // request.url carries the server's own hostname, so build the target from the agency
  return NextResponse.redirect(`${agencyOrigin(agency.subdomain)}/`, 303);
}
