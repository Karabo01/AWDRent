import { signingDocument } from "@awdrent/core/signing";
import { NextResponse } from "next/server";
import { currentAgency } from "@/server/session";

export const dynamic = "force-dynamic";

/** The document for a signer to read: the version sent for signing, or the signed original once complete. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const agency = await currentAgency();
  const { token } = await params;
  const doc = await signingDocument(agency.id, token);
  if (!doc) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(Buffer.from(doc.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${doc.filename.replace(/[^A-Za-z0-9 ._()-]/g, "")}"`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
