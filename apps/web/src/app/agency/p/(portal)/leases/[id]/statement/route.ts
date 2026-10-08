import { agencyOrigin } from "@awdrent/core/hosts";
import { portalStatementPdf } from "@awdrent/core/portal";
import { NotFoundError } from "@awdrent/core/portfolio";
import { NextResponse } from "next/server";
import { z } from "zod";
import { optionalTenant } from "@/server/portal-session";
import { currentAgency } from "@/server/session";

export const dynamic = "force-dynamic";

/** The tenant's statement as a branded PDF, generated on request. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const t = await optionalTenant();
  const { id } = await params;
  if (!t) {
    const origin = agencyOrigin((await currentAgency()).subdomain);
    return NextResponse.redirect(`${origin}/p/login?next=${encodeURIComponent(`/p/leases/${id}`)}`, 303);
  }
  if (!z.uuid().safeParse(id).success) return new NextResponse("Not found", { status: 404 });
  try {
    const { bytes, filename } = await portalStatementPdf(t.actor, id);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename.replace(/[^A-Za-z0-9 ._-]/g, "")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof NotFoundError) return new NextResponse("Not found", { status: 404 });
    throw err;
  }
}
