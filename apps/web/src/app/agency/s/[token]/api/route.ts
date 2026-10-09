import { agencyOrigin } from "@awdrent/core/hosts";
import { NotFoundError } from "@awdrent/core/portfolio";
import { declineSchema, declineSigning, sendSigningCode, signDocument, SigningError, signSchema, verifySigningCode } from "@awdrent/core/signing";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentAgency } from "@/server/session";

export const dynamic = "force-dynamic";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("code") }),
  z.object({ action: z.literal("verify"), code: z.string().max(10) }),
  z.object({ action: z.literal("sign"), signedName: z.string(), consent: z.boolean(), signature: z.string().max(450_000) }),
  z.object({ action: z.literal("decline"), reason: z.string() }),
]);

/** The client's address as Traefik passes it on (first hop), for the signing certificate. */
function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

const fail = (message: string, status = 400) => NextResponse.json({ message }, { status });

/** The signer's steps on a personal link: get a code, confirm it, sign or decline. No login; the token is the key. */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const agency = await currentAgency();
  const origin = request.headers.get("origin");
  if (origin && origin !== agencyOrigin(agency.subdomain)) return fail("Forbidden", 403);
  const { token } = await params;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Something was missing. Please try again.");
  const input = parsed.data;
  try {
    if (input.action === "code") {
      const sent = await sendSigningCode(agency.id, token);
      return sent ? NextResponse.json(sent) : fail("This link can no longer be used.", 410);
    }
    if (input.action === "verify") {
      const result = await verifySigningCode(agency.id, token, input.code);
      if (result === "ok") return NextResponse.json({ ok: true });
      return fail(
        result === "locked"
          ? "Too many tries. Ask for a new code."
          : result === "expired"
            ? "That code has expired. Ask for a new one."
            : "That code is not right. Check it and try again.",
      );
    }
    if (input.action === "sign") {
      const fields = signSchema.safeParse({ signedName: input.signedName, consent: input.consent });
      if (!fields.success) return fail(fields.error.issues[0]!.message);
      const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(input.signature);
      if (!match) return fail("Draw your signature in the box.");
      const result = await signDocument(agency.id, token, {
        signedName: fields.data.signedName,
        signaturePng: new Uint8Array(Buffer.from(match[1]!, "base64")),
        ipAddress: clientIp(request),
        userAgent: request.headers.get("user-agent") ?? "",
      });
      return NextResponse.json({ result });
    }
    const reason = declineSchema.safeParse({ reason: input.reason });
    if (!reason.success) return fail(reason.error.issues[0]!.message);
    await declineSigning(agency.id, token, reason.data.reason);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof SigningError) return fail(err.message);
    if (err instanceof NotFoundError) return fail("This link is not valid.", 404);
    throw err;
  }
}
