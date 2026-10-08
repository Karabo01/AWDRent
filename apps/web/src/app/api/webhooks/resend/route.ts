import { env } from "@awdrent/config";
import { recordDelivery } from "@awdrent/core/messages";
import { resendStatus, verifySvix } from "@awdrent/core/messaging/webhooks";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Resend delivery events (email.sent, delivered, opened, bounced, failed).
 * Verified by Svix signature before anything is read; served on the admin host only.
 */
export async function POST(request: Request) {
  const secret = env().RESEND_WEBHOOK_SECRET;
  if (!secret) return new NextResponse("Not configured", { status: 404 });
  const raw = await request.text();
  if (raw.length > 256_000) return new NextResponse("Too large", { status: 413 });
  const ok = verifySvix(
    secret,
    {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    },
    raw,
  );
  if (!ok) return new NextResponse("Invalid signature", { status: 401 });

  let event: { type?: string; data?: { email_id?: string; bounce?: { message?: string }; failed?: { reason?: string } } };
  try {
    event = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad JSON", { status: 400 });
  }
  const status = resendStatus(event.type ?? "");
  const id = event.data?.email_id;
  if (!status || !id) return NextResponse.json({ result: "ignored" });
  const detail = event.data?.bounce?.message ?? event.data?.failed?.reason ?? (status === "failed" ? event.type : null);
  const result = await recordDelivery("resend", id, status, detail);
  return NextResponse.json({ result });
}
