import { agencyOrigin } from "@awdrent/core/hosts";
import { UploadRejectedError } from "@awdrent/core/documents";
import { ForbiddenError } from "@awdrent/core/permissions";
import { popClaimSchema, submitPop } from "@awdrent/core/pops";
import { NotFoundError } from "@awdrent/core/portfolio";
import { enqueueScan } from "@awdrent/core/queue";
import { MAX_UPLOAD_BYTES } from "@awdrent/core/storage";
import { NextResponse } from "next/server";
import { z } from "zod";
import { actorOf } from "@/server/actor";
import { formValues } from "@/server/forms";
import { requireCan } from "@/server/session";
import { readOnlyError } from "@/server/writes";

export const dynamic = "force-dynamic";

/** Staff upload a tenant's proof of payment (plain multipart post); back to the lease with ?pop=<result>. */
export async function POST(request: Request) {
  const s = await requireCan("pop.submit");
  const origin = agencyOrigin(s.agency.subdomain);
  const from = request.headers.get("origin");
  if (from && from !== origin) return new NextResponse("Forbidden", { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES + 1024 * 1024) return new NextResponse("Too large", { status: 413 });
  const form = await request.formData();
  const leaseId = z.uuid().safeParse(form.get("leaseId"));
  if (!leaseId.success) return new NextResponse("Not found", { status: 404 });
  const back = (result: string) => NextResponse.redirect(`${origin}/leases/${leaseId.data}?pop=${encodeURIComponent(result)}#pops`, 303);
  const claim = popClaimSchema.safeParse(formValues(form));
  const file = form.get("file");
  if (!claim.success) return back(claim.error.issues[0]?.message ?? "Check the amount and date.");
  if (!(file instanceof File)) return back("Choose the proof of payment file.");
  try {
    const { documentId } = await submitPop(actorOf(s), {
      leaseId: leaseId.data,
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      claim: claim.data,
      via: "staff",
    });
    await enqueueScan({ agencyId: s.agency.id, documentId });
  } catch (err) {
    if (err instanceof UploadRejectedError) return back(err.message);
    if (err instanceof NotFoundError || err instanceof ForbiddenError) return new NextResponse("Not found", { status: 404 });
    if (readOnlyError(err)) return back("This support session is read-only.");
    throw err;
  }
  return back("ok");
}
