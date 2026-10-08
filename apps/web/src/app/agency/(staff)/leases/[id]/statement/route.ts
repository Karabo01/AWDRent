import { ForbiddenError } from "@awdrent/core/permissions";
import { NotFoundError } from "@awdrent/core/portfolio";
import { statementPdf } from "@awdrent/core/receipts";
import { NextResponse } from "next/server";
import { z } from "zod";
import { actorOf } from "@/server/actor";
import { requireCan } from "@/server/session";
import { readOnlyError } from "@/server/writes";

export const dynamic = "force-dynamic";

/** The lease statement as a branded PDF, generated on request (spec). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireCan("ledger.view");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new NextResponse("Not found", { status: 404 });
  try {
    const { bytes, filename } = await statementPdf(actorOf(s), id);
    const safeName = filename.replace(/[^A-Za-z0-9 ._-]/g, "");
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) return new NextResponse("Not found", { status: 404 });
    if (readOnlyError(err)) return new NextResponse("Statements are logged, so they need a support session with write access.", { status: 403 });
    throw err;
  }
}
