import "server-only";
import { env } from "@awdrent/config";
import { devOutbox } from "@awdrent/core/email";

/**
 * Local development without Resend: the newest link emailed to an address,
 * so invites can be followed from the screen. Always null in production.
 */
export function devEmailLink(email: string): string | null {
  if (env().NODE_ENV === "production" || env().RESEND_API_KEY) return null;
  const mail = [...devOutbox].reverse().find((m) => m.to === email);
  return mail?.text.match(/https?:\/\/\S+/)?.[0] ?? null;
}
