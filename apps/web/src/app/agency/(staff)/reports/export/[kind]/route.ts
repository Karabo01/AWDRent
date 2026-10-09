import { ForbiddenError } from "@awdrent/core/permissions";
import { ExportError, type ExportKind, exportCsv } from "@awdrent/core/reports";
import { NextResponse } from "next/server";
import { actorOf } from "@/server/actor";
import { requireCan } from "@/server/session";
import { readOnlyError } from "@/server/writes";

export const dynamic = "force-dynamic";

const KINDS: ExportKind[] = ["transactions", "receipts", "owner-statements", "arrears"];

/** A CSV export (D116); audited. */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const s = await requireCan("exports.run");
  const { kind } = await params;
  if (!KINDS.includes(kind as ExportKind)) return new NextResponse("Not found", { status: 404 });
  const url = new URL(request.url);
  try {
    const { csv, filename } = await exportCsv(actorOf(s), kind as ExportKind, { from: url.searchParams.get("from") ?? "", to: url.searchParams.get("to") ?? "" });
    // A byte-order mark, so Excel reads the file as UTF-8
    return new NextResponse(String.fromCharCode(0xfeff) + csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename.replace(/[^A-Za-z0-9 ._-]/g, "")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof ExportError) return new NextResponse(err.message, { status: 400 });
    if (err instanceof ForbiddenError) return new NextResponse("Not found", { status: 404 });
    if (readOnlyError(err)) return new NextResponse("Exports are logged, so they need a support session with write access.", { status: 403 });
    throw err;
  }
}
