import { env } from "@awdrent/config";

// Channel providers behind one interface (spec: pluggable channels, so
// WhatsApp is a new provider, not a rebuild). Without an API key, messages go
// to an in-memory dev outbox; production refuses that and fails the message
// instead, so an SMS falls back to email and nothing is silently dropped.

export interface OutgoingEmail {
  /** Our message id: Resend's idempotency key, so a retried job never sends twice. */
  messageId: string;
  fromName: string;
  replyTo: string | null;
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments: { filename: string; content: Uint8Array }[];
}

export interface OutgoingSms {
  messageId: string;
  /** Agency sender ID registered on the AWDTECH account (D38); null for the default */
  from: string | null;
  /** MSISDN, e.g. 27821234567 */
  to: string;
  text: string;
}

export interface Sent {
  provider: string;
  providerId: string;
}

/** The provider refused this message for good (bad number or address); retrying will not help. */
export class PermanentSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentSendError";
  }
}

export interface Providers {
  email(message: OutgoingEmail): Promise<Sent>;
  sms(message: OutgoingSms): Promise<Sent>;
}

export interface DevMessage {
  channel: "email" | "sms";
  to: string;
  subject?: string;
  text: string;
  attachments?: string[];
  sentAt: Date;
}

/** Messages "sent" without provider keys, newest last. Shared across bundles in one process. */
const store = globalThis as { __awdDevMessages?: DevMessage[] };
export const devMessages: DevMessage[] = (store.__awdDevMessages ??= []);

function toDevOutbox(message: Omit<DevMessage, "sentAt">, id: string): Sent {
  if (env().NODE_ENV === "production") throw new Error(`${message.channel} is not configured (no API key)`);
  devMessages.push({ ...message, sentAt: new Date() });
  if (devMessages.length > 200) devMessages.shift();
  if (env().NODE_ENV !== "test") console.info(`[${message.channel}:dev] to=${message.to}${message.subject ? ` subject="${message.subject}"` : ""}\n${message.text}`);
  return { provider: "dev", providerId: id };
}

/** Puts a display name on the platform sender: "Kgosi Letting via AWDRent <no-reply@…>". */
export function fromAddress(fromName: string, configured = env().EMAIL_FROM): string {
  const address = /<([^>]+)>/.exec(configured)?.[1] ?? configured.trim();
  const platform = /^(.*?)\s*</.exec(configured)?.[1]?.replace(/"/g, "").trim() || "AWDRent";
  const name = `${fromName} via ${platform}`.replace(/["\\<>\r\n]/g, "");
  return `"${name}" <${address}>`;
}

async function resend(message: OutgoingEmail): Promise<Sent> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env().RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": message.messageId,
    },
    body: JSON.stringify({
      from: fromAddress(message.fromName),
      to: [message.to],
      reply_to: message.replyTo ?? undefined,
      subject: message.subject,
      html: message.html,
      text: message.text,
      attachments: message.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString("base64") })),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
  if (res.ok && body.id) return { provider: "resend", providerId: body.id };
  const detail = `Resend ${res.status}: ${body.message ?? body.name ?? "no detail"}`;
  // 422 is a bad address or message; 4xx other than rate limits will not succeed on retry either
  if (res.status === 422 || (res.status >= 400 && res.status < 500 && res.status !== 429 && res.status !== 409)) throw new PermanentSendError(detail);
  throw new Error(detail);
}

interface ClickatellResponse {
  messages?: { apiMessageId?: string; accepted?: boolean; to?: string; error?: string; errorDescription?: string }[];
  error?: string;
  errorDescription?: string;
}

async function clickatell(message: OutgoingSms): Promise<Sent> {
  const res = await fetch("https://platform.clickatell.com/messages", {
    method: "POST",
    headers: { Authorization: env().CLICKATELL_API_KEY!, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      content: message.text,
      to: [message.to],
      ...(message.from ? { from: message.from } : {}),
      clientMessageId: message.messageId,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as ClickatellResponse;
  const result = body.messages?.[0];
  if (res.ok && result?.accepted && result.apiMessageId) return { provider: "clickatell", providerId: result.apiMessageId };
  const detail = `Clickatell ${res.status}: ${result?.errorDescription ?? result?.error ?? body.errorDescription ?? body.error ?? "no detail"}`;
  // The request was fine but this number was refused
  if (res.ok && result && !result.accepted) throw new PermanentSendError(detail);
  throw new Error(detail);
}

/** The configured providers. Tests pass their own to the delivery step instead. */
export function defaultProviders(): Providers {
  return {
    email: async (m) =>
      env().RESEND_API_KEY
        ? resend(m)
        : toDevOutbox({ channel: "email", to: m.to, subject: m.subject, text: m.text, attachments: m.attachments.map((a) => a.filename) }, m.messageId),
    sms: async (m) => (env().CLICKATELL_API_KEY ? clickatell(m) : toDevOutbox({ channel: "sms", to: m.to, text: m.text }, m.messageId)),
  };
}
