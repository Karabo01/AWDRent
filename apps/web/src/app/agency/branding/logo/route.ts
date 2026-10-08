import { logoFile } from "@awdrent/core/branding";
import { NextResponse } from "next/server";
import { currentAgency } from "@/server/session";

export const dynamic = "force-dynamic";

/**
 * The agency's logo, public on its own host (sign-in page, emails, PDFs).
 * Only the logo the agency set is served, from its own storage prefix.
 */
export async function GET() {
  const agency = await currentAgency();
  const file = await logoFile(agency).catch(() => null);
  if (!file) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(Buffer.from(file.bytes), {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "public, max-age=300",
      "Content-Security-Policy": "default-src 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
