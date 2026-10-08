import { agencyOrigin } from "@awdrent/core/hosts";
import { portalReceiptUrl } from "@awdrent/core/portal";
import { NotFoundError } from "@awdrent/core/portfolio";
import { NextResponse } from "next/server";
import { currentAgency } from "@/server/session";
import { optionalTenant } from "@/server/portal-session";

export const dynamic = "force-dynamic";

/** One of the tenant's receipts: a short-lived signed download link, after sign-in. */
export async function GET(_request: Request, { params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  if (!/^[A-Z]{2,4}-R\d{6,}$/.test(number)) return new NextResponse("Not found", { status: 404 });
  const t = await optionalTenant();
  const origin = agencyOrigin((await currentAgency()).subdomain);
  if (!t) return NextResponse.redirect(`${origin}/p/login?next=${encodeURIComponent(`/p/receipts/${number}`)}`, 303);
  try {
    return NextResponse.redirect(await portalReceiptUrl(t.actor, number), 303);
  } catch (err) {
    if (err instanceof NotFoundError) return new NextResponse("Not found", { status: 404 });
    throw err;
  }
}
