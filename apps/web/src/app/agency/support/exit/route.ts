import { agencyOrigin } from "@awdrent/core/hosts";
import { SUPPORT_COOKIE } from "@awdrent/core/support";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentAgency } from "@/server/session";

export const dynamic = "force-dynamic";

export async function POST() {
  const agency = await currentAgency();
  (await cookies()).delete(SUPPORT_COOKIE);
  return NextResponse.redirect(`${agencyOrigin(agency.subdomain)}/login`, 303);
}
