import { createHmac, timingSafeEqual } from "node:crypto";

// Delivery-report webhooks (spec: verified before anything is trusted).
//   Resend     signs with Svix: HMAC-SHA256 over "id.timestamp.body".
//   Clickatell does not sign callbacks; it sends HTTP basic auth that we set
//              on the integration (D70). Both endpoints are HTTPS only.

export type DeliveryStatus = "sent" | "delivered" | "read" | "failed";

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Verifies a Svix-signed request. Rejects stale timestamps to stop replays. */
export function verifySvix(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  rawBody: string,
  now = Date.now(),
  toleranceSeconds = 300,
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > toleranceSeconds) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  if (key.length === 0) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
  return signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    return version === "v1" && !!sig && safeEqual(sig, expected);
  });
}

/** Checks an "Authorization: Basic …" header against the configured credentials. */
export function verifyBasicAuth(header: string | null, user: string | undefined, password: string | undefined): boolean {
  if (!user || !password || !header?.startsWith("Basic ")) return false;
  const given = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
  // Compare the whole "user:password" so neither part leaks through timing
  return safeEqual(given, `${user}:${password}`);
}

/** Resend event type → our status; null for events that do not change it (clicks, delays). */
export function resendStatus(type: string): DeliveryStatus | null {
  switch (type) {
    case "email.sent":
      return "sent";
    case "email.delivered":
      return "delivered";
    case "email.opened":
      return "read";
    case "email.bounced":
    case "email.failed":
      return "failed";
    default:
      return null;
  }
}

const CLICKATELL_FAILED = new Set(["005", "006", "007", "009", "010", "012", "014"]);

/** Clickatell status code ("004") or name → our status; null for in-between states. */
export function clickatellStatus(statusCode: string | number | null | undefined, status: string | null | undefined): DeliveryStatus | null {
  const code = statusCode == null ? "" : String(statusCode).padStart(3, "0");
  const name = (status ?? "").toUpperCase();
  if (code === "004" || name === "RECEIVED_BY_RECIPIENT") return "delivered";
  if (CLICKATELL_FAILED.has(code) || /ERROR|EXPIRED|CANCELLED|CREDIT/.test(name)) return "failed";
  if (code === "003" || name === "DELIVERED_TO_GATEWAY") return "sent";
  return null;
}

/** Whether a report may move a message from `current` to `next` (reports can arrive out of order). */
export function advancesStatus(current: string, next: DeliveryStatus): boolean {
  const rank: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3 };
  if (current === "failed" || current === "suppressed") return false;
  if (next === "failed") return current === "sent" || current === "queued";
  return (rank[next] ?? 0) > (rank[current] ?? 0);
}
