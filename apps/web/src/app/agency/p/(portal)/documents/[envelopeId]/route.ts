import { agencyOrigin } from "@awdrent/core/hosts";
import { portalSignedDocumentUrl } from "@awdrent/core/portal";
import { NotFoundError } from "@awdrent/core/portfolio";
import { NextResponse } from "next/server";
import { z } from "zod";
import { optionalTenant } from "@/server/portal-session";
import { currentAgency } from "@/server/session";

export const dynamic = "force-dynamic";

/** A signed lease document for the tenant: a short-lived signed download link, after sign-in. */
export async function GET(_request: Request, { params }: { params: Promise<{ envelopeId: string }> }) {
  const { envelopeId } = await params;
  if (!z.uuid().safeParse(envelopeId).success) return new NextResponse("Not found", { status: 404 });
  const t = await optionalTenant();
  if (!t) {
    const origin = agencyOrigin((await currentAgency()).subdomain);
    return NextResponse.redirect(`${origin}/p/login?next=${encodeURIComponent(`/p/documents/${envelopeId}`)}`, 303);
  }
  try {
    return NextResponse.redirect(await portalSignedDocumentUrl(t.actor, envelopeId), 303);
  } catch (err) {
    if (err instanceof NotFoundError) return new NextResponse("Not found", { status: 404 });
    throw err;
  }
}
