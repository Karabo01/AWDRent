import { env } from "@awdrent/config";
import { recordDelivery } from "@awdrent/core/messages";
import { clickatellStatus, verifyBasicAuth } from "@awdrent/core/messaging/webhooks";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Clickatell SMS delivery reports (POST, JSON). Clickatell does not sign
 * callbacks, so the integration sends basic-auth credentials we set (D70);
 * served on the admin host only, over HTTPS.
 */
export async function POST(request: Request) {
  const { CLICKATELL_CALLBACK_USER: user, CLICKATELL_CALLBACK_PASSWORD: password } = env();
  if (!user || !password) return new NextResponse("Not configured", { status: 404 });
  if (!verifyBasicAuth(request.headers.get("authorization"), user, password)) {
    return new NextResponse("Unauthorised", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="awdrent"' } });
  }
  const raw = await request.text();
  if (raw.length > 64_000) return new NextResponse("Too large", { status: 413 });
  let report: { messageId?: string; statusCode?: string | number; status?: string; statusDescription?: string };
  try {
    report = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad JSON", { status: 400 });
  }
  const status = clickatellStatus(report.statusCode, report.status);
  if (!status || !report.messageId) return NextResponse.json({ result: "ignored" });
  const result = await recordDelivery("clickatell", report.messageId, status, report.statusDescription ?? report.status ?? null);
  return NextResponse.json({ result });
}
