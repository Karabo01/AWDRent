import { env } from "@awdrent/config";

// Minimal transactional email for Phase 1 (staff invites, password resets).
// Phase 2 replaces callers with the messaging service and its log.

export interface Email {
  to: string;
  subject: string;
  text: string;
}

export interface SentEmail extends Email {
  sentAt: Date;
}

/** Emails "sent" without a Resend key, newest last. For local dev and tests. */
export const devOutbox: SentEmail[] = [];

export async function sendEmail(email: Email): Promise<void> {
  const e = env();
  if (!e.RESEND_API_KEY) {
    devOutbox.push({ ...email, sentAt: new Date() });
    if (devOutbox.length > 100) devOutbox.shift();
    if (e.NODE_ENV !== "test") console.info(`[email:dev] to=${email.to} subject="${email.subject}"\n${email.text}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${e.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: e.EMAIL_FROM, to: [email.to], subject: email.subject, text: email.text }),
  });
  if (!res.ok) throw new Error(`Resend rejected email: ${res.status} ${await res.text()}`);
}
