import { agencyOrigin } from "@awdrent/core/hosts";
import { ownerStatementUrl } from "@awdrent/core/owner-portal";
import { NotFoundError } from "@awdrent/core/portfolio";
import { NextResponse } from "next/server";
import { z } from "zod";
import { optionalOwner } from "@/server/portal-session";
import { currentAgency } from "@/server/session";

export const dynamic = "force-dynamic";

/** One of the owner's statement PDFs: a short-lived signed link, after sign-in. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new NextResponse("Not found", { status: 404 });
  const o = await optionalOwner();
  if (!o) {
    const origin = agencyOrigin((await currentAgency()).subdomain);
    return NextResponse.redirect(`${origin}/op/login?next=${encodeURIComponent(`/op/statements`)}`, 303);
  }
  try {
    return NextResponse.redirect(await ownerStatementUrl(o.actor, id), 303);
  } catch (err) {
    if (err instanceof NotFoundError) return new NextResponse("Not found", { status: 404 });
    throw err;
  }
}
