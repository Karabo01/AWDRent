import { IMPORT_FILES, type ImportFile, templateCsv } from "@awdrent/core/import";
import { NextResponse } from "next/server";
import { requireCan } from "@/server/session";

export const dynamic = "force-dynamic";

/** /import/template/owners.csv etc.: header row plus one example row. */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  await requireCan("import.run");
  const name = (await params).file.replace(/\.csv$/, "");
  if (!(IMPORT_FILES as readonly string[]).includes(name)) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(templateCsv(name as ImportFile), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
