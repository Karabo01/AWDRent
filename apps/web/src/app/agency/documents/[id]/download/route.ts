import { documentDownloadUrl } from "@awdrent/core/documents";
import { ForbiddenError } from "@awdrent/core/permissions";
import { NotFoundError } from "@awdrent/core/portfolio";
import { NextResponse } from "next/server";
import { z } from "zod";
import { actorOf } from "@/server/actor";
import { requireCan } from "@/server/session";
import { readOnlyError } from "@/server/writes";

export const dynamic = "force-dynamic";

/**
 * Checks access (RLS + portfolio), records the download in the audit log and
 * redirects to a 5-minute signed link. The link itself is never stored.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireCan("documents.view");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new NextResponse("Not found", { status: 404 });
  try {
    const url = await documentDownloadUrl(actorOf(s), id);
    const res = NextResponse.redirect(url, 302);
    res.headers.set("Cache-Control", "no-store");
    res.headers.set("Referrer-Policy", "no-referrer");
    return res;
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) return new NextResponse("Not found", { status: 404 });
    // Read-only support sessions cannot write the audit entry a download needs
    if (readOnlyError(err)) {
      return new NextResponse("Downloads are logged, so they need a support session with write access.", { status: 403 });
    }
    throw err;
  }
}
