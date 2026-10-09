import { UploadRejectedError } from "@awdrent/core/documents";
import { agencyOrigin } from "@awdrent/core/hosts";
import { ApplicationError, uploadApplicationFile } from "@awdrent/core/onboarding";
import { NotFoundError } from "@awdrent/core/portfolio";
import { enqueueScan } from "@awdrent/core/queue";
import { MAX_UPLOAD_BYTES } from "@awdrent/core/storage";
import { NextResponse } from "next/server";
import { currentAgency } from "@/server/session";

export const dynamic = "force-dynamic";

/** An applicant's file for one checklist item (plain multipart post); back to their page. */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const agency = await currentAgency();
  const origin = agencyOrigin(agency.subdomain);
  const from = request.headers.get("origin");
  if (from && from !== origin) return new NextResponse("Forbidden", { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES + 1024 * 1024) return new NextResponse("Too large", { status: 413 });
  const { token } = await params;
  const back = (result: string) => NextResponse.redirect(`${origin}/a/${token}?upload=${encodeURIComponent(result)}`, 303);
  const form = await request.formData();
  const file = form.get("file");
  const itemKey = String(form.get("itemKey") ?? "");
  if (!(file instanceof File) || file.size === 0) return back("Choose a file.");
  try {
    const documentId = await uploadApplicationFile(agency.id, token, { itemKey, filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    await enqueueScan({ agencyId: agency.id, documentId });
  } catch (err) {
    if (err instanceof UploadRejectedError || err instanceof ApplicationError) return back(err.message);
    if (err instanceof NotFoundError) return new NextResponse("Not found", { status: 404 });
    throw err;
  }
  return back("ok");
}
