import { ForbiddenError } from "@awdrent/core/permissions";
import { payoutCsv } from "@awdrent/core/payouts";
import { NotFoundError } from "@awdrent/core/portfolio";
import { NextResponse } from "next/server";
import { z } from "zod";
import { actorOf } from "@/server/actor";
import { requireCan } from "@/server/session";
import { readOnlyError } from "@/server/writes";

export const dynamic = "force-dynamic";

/** The bulk-payment file for the bank. Admins only (full account numbers, D6); audited. */
export async function GET(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const s = await requireCan("owner.bank.view");
  const { batchId } = await params;
  if (!z.uuid().safeParse(batchId).success) return new NextResponse("Not found", { status: 404 });
  try {
    const { csv, filename } = await payoutCsv(actorOf(s), batchId);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename.replace(/[^A-Za-z0-9 ._-]/g, "")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) return new NextResponse("Not found", { status: 404 });
    if (readOnlyError(err)) return new NextResponse("Downloads are logged, so they need a support session with write access.", { status: 403 });
    throw err;
  }
}
