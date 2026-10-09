import { ForbiddenError } from "@awdrent/core/permissions";
import { NotFoundError } from "@awdrent/core/portfolio";
import { previewStatementPdf } from "@awdrent/core/statements";
import { NextResponse } from "next/server";
import { z } from "zod";
import { actorOf } from "@/server/actor";
import { requireCan } from "@/server/session";

export const dynamic = "force-dynamic";

/** A draft owner statement as a PDF, before approval. */
export async function GET(_request: Request, { params }: { params: Promise<{ statementId: string }> }) {
  const s = await requireCan("statements.manage");
  const { statementId } = await params;
  if (!z.uuid().safeParse(statementId).success) return new NextResponse("Not found", { status: 404 });
  try {
    const bytes = await previewStatementPdf(actorOf(s), statementId);
    return new NextResponse(Buffer.from(bytes), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="Owner statement (draft).pdf"', "Cache-Control": "no-store" },
    });
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) return new NextResponse("Not found", { status: 404 });
    throw err;
  }
}
