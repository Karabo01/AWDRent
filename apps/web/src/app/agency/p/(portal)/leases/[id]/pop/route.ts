import { UploadRejectedError } from "@awdrent/core/documents";
import { agencyOrigin } from "@awdrent/core/hosts";
import { popClaimSchema } from "@awdrent/core/pops";
import { portalSubmitPop } from "@awdrent/core/portal";
import { NotFoundError } from "@awdrent/core/portfolio";
import { enqueueScan } from "@awdrent/core/queue";
import { MAX_UPLOAD_BYTES } from "@awdrent/core/storage";
import { NextResponse } from "next/server";
import { z } from "zod";
import { formValues } from "@/server/forms";
import { optionalTenant } from "@/server/portal-session";

export const dynamic = "force-dynamic";

/** A tenant sends a proof of payment (plain multipart post); back to the lease page with ?pop=<result>. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const t = await optionalTenant();
  if (!t) return new NextResponse("Sign in first", { status: 401 });
  const origin = agencyOrigin(t.agency.subdomain);
  const from = request.headers.get("origin");
  if (from && from !== origin) return new NextResponse("Forbidden", { status: 403 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new NextResponse("Not found", { status: 404 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES + 1024 * 1024) return new NextResponse("Too large", { status: 413 });
  const back = (result: string) => NextResponse.redirect(`${origin}/p/leases/${id}?pop=${encodeURIComponent(result)}#pop`, 303);
  const form = await request.formData();
  const claim = popClaimSchema.safeParse(formValues(form));
  const file = form.get("file");
  if (!claim.success) return back(claim.error.issues[0]?.message ?? "Check the amount and date.");
  if (!(file instanceof File)) return back("Choose the proof of payment file.");
  try {
    const { documentId } = await portalSubmitPop(t.actor, {
      leaseId: id,
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      claim: claim.data,
    });
    await enqueueScan({ agencyId: t.agency.id, documentId });
  } catch (err) {
    if (err instanceof UploadRejectedError) return back(err.message);
    if (err instanceof NotFoundError) return new NextResponse("Not found", { status: 404 });
    throw err;
  }
  return back("ok");
}
