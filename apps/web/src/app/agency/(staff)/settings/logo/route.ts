import { LogoRejectedError, MAX_LOGO_BYTES, uploadLogo } from "@awdrent/core/branding";
import { agencyOrigin } from "@awdrent/core/hosts";
import { enqueueLogoScan } from "@awdrent/core/queue";
import { NextResponse } from "next/server";
import { actorOf } from "@/server/actor";
import { requireCan } from "@/server/session";
import { readOnlyError } from "@/server/writes";

export const dynamic = "force-dynamic";

/** Logo upload from Settings (plain multipart post); redirects back with ?logo=<result>. */
export async function POST(request: Request) {
  const s = await requireCan("settings.manage");
  const origin = agencyOrigin(s.agency.subdomain);
  const back = (result: string) => NextResponse.redirect(`${origin}/settings?logo=${encodeURIComponent(result)}`, 303);
  if (s.ctx.readOnly) return back("This support session is read-only.");
  const from = request.headers.get("origin");
  if (from && from !== origin) return new NextResponse("Forbidden", { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_LOGO_BYTES + 64 * 1024) return back("Logos can be at most 1 MB.");
  const file = (await request.formData()).get("logo");
  if (!(file instanceof File)) return back("Choose an image file.");
  try {
    const key = await uploadLogo(actorOf(s), new Uint8Array(await file.arrayBuffer()));
    const queued = await enqueueLogoScan({ agencyId: s.agency.id, logoKey: key });
    return back(queued ? "ok" : "The logo was saved but could not be checked for viruses yet. Upload it again in a few minutes.");
  } catch (err) {
    if (err instanceof LogoRejectedError) return back(err.message);
    if (readOnlyError(err)) return back("This support session is read-only.");
    throw err;
  }
}
