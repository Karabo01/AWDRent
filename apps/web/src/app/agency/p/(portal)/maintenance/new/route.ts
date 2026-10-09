import { UploadRejectedError } from "@awdrent/core/documents";
import { agencyOrigin } from "@awdrent/core/hosts";
import { MaintenanceError, portalLogRequest, requestSchema } from "@awdrent/core/maintenance";
import { NotFoundError } from "@awdrent/core/portfolio";
import { enqueueScan } from "@awdrent/core/queue";
import { MAX_UPLOAD_BYTES } from "@awdrent/core/storage";
import { NextResponse } from "next/server";
import { z } from "zod";
import { formValues } from "@/server/forms";
import { optionalTenant } from "@/server/portal-session";

export const dynamic = "force-dynamic";

/** A tenant logs a maintenance request with photos (plain multipart post). */
export async function POST(request: Request) {
  const t = await optionalTenant();
  if (!t) return new NextResponse("Sign in first", { status: 401 });
  const origin = agencyOrigin(t.agency.subdomain);
  const from = request.headers.get("origin");
  if (from && from !== origin) return new NextResponse("Forbidden", { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 5 * MAX_UPLOAD_BYTES + 1024 * 1024) return new NextResponse("Too large", { status: 413 });
  const back = (query: string) => NextResponse.redirect(`${origin}/p/maintenance?${query}`, 303);
  const form = await request.formData();
  const leaseId = z.uuid().safeParse(form.get("leaseId"));
  const fields = requestSchema.safeParse(formValues(form));
  if (!leaseId.success) return new NextResponse("Not found", { status: 404 });
  if (!fields.success) return back(`error=${encodeURIComponent(fields.error.issues[0]?.message ?? "Describe the problem.")}`);
  const files = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  try {
    const { documentIds } = await portalLogRequest(t.actor, {
      leaseId: leaseId.data,
      title: fields.data.title,
      description: fields.data.description,
      photos: await Promise.all(files.map(async (f) => ({ filename: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))),
    });
    for (const documentId of documentIds) await enqueueScan({ agencyId: t.agency.id, documentId });
  } catch (err) {
    if (err instanceof MaintenanceError || err instanceof UploadRejectedError) return back(`error=${encodeURIComponent(err.message)}`);
    if (err instanceof NotFoundError) return new NextResponse("Not found", { status: 404 });
    throw err;
  }
  return back("logged=1");
}
