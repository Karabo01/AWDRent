import { agencyOrigin } from "@awdrent/core/hosts";
import { DOCUMENT_KINDS, subjectSchema, UploadRejectedError, uploadDocument } from "@awdrent/core/documents";
import { ForbiddenError } from "@awdrent/core/permissions";
import { NotFoundError } from "@awdrent/core/portfolio";
import { enqueueScan } from "@awdrent/core/queue";
import { MAX_UPLOAD_BYTES } from "@awdrent/core/storage";
import { NextResponse } from "next/server";
import { z } from "zod";
import { actorOf } from "@/server/actor";
import { requireCan } from "@/server/session";
import { readOnlyError } from "@/server/writes";

export const dynamic = "force-dynamic";

const fields = z.object({
  subjectType: subjectSchema.shape.type,
  subjectId: subjectSchema.shape.id,
  kind: z.enum(DOCUMENT_KINDS),
  // Same-origin page to return to
  returnTo: z.string().regex(/^\/[a-z0-9/-]*$/i),
});

/**
 * Multipart upload from the documents panel. Plain form post (works without
 * JavaScript); redirects back with ?upload=ok or ?upload=<message>.
 */
export async function POST(request: Request) {
  const s = await requireCan("documents.upload");
  const origin = agencyOrigin(s.agency.subdomain);
  const back = (path: string, result: string) =>
    NextResponse.redirect(`${origin}${path}?upload=${encodeURIComponent(result)}#documents`, 303);

  // Same-origin only (cookies are SameSite=Lax as well)
  const from = request.headers.get("origin");
  if (from && from !== origin) return new NextResponse("Forbidden", { status: 403 });
  // Refuse obviously oversized bodies before parsing them
  if (Number(request.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES + 1024 * 1024) {
    return back("/", "Files can be at most 10 MB.");
  }
  const form = await request.formData();
  const parsed = fields.safeParse(Object.fromEntries(form));
  const file = form.get("file");
  if (!parsed.success || !(file instanceof File)) return back("/", "The upload was incomplete. Try again.");
  const { subjectType, subjectId, kind, returnTo } = parsed.data;

  try {
    const documentId = await uploadDocument(actorOf(s), {
      subject: { type: subjectType, id: subjectId },
      kind,
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    await enqueueScan({ agencyId: s.agency.id, documentId });
  } catch (err) {
    if (err instanceof UploadRejectedError) return back(returnTo, err.message);
    if (err instanceof NotFoundError || err instanceof ForbiddenError) return new NextResponse("Not found", { status: 404 });
    const ro = readOnlyError(err);
    if (ro?.error) return back(returnTo, ro.error);
    throw err;
  }
  return back(returnTo, "ok");
}
