import { ForbiddenError } from "@awdrent/core/permissions";
import { NotFoundError } from "@awdrent/core/portfolio";
import { prepareSchema, previewDocument, SigningError } from "@awdrent/core/signing";
import { NextResponse } from "next/server";
import { z } from "zod";
import { actorOf } from "@/server/actor";
import { requireCan } from "@/server/session";

export const dynamic = "force-dynamic";

/** A watermarked draft of the document, before it is sent for signing. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireCan("documents.prepare");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new NextResponse("Not found", { status: 404 });
  const input = prepareSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!input.success) return new NextResponse("Choose who signs first.", { status: 400 });
  try {
    const { bytes } = await previewDocument(actorOf(s), id, input.data);
    return new NextResponse(Buffer.from(bytes), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="Draft.pdf"', "Cache-Control": "no-store" },
    });
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) return new NextResponse("Not found", { status: 404 });
    if (err instanceof SigningError) return new NextResponse(err.message, { status: 400 });
    throw err;
  }
}
