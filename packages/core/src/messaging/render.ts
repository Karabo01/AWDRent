// Pure helpers for turning catalogue wording into what is sent. No I/O here,
// so all of it is unit tested.

export const SMS_LIMIT = 160;

const VARIABLE = /\{([a-z_]+)\}/g;

/** Replaces {variable} with its value; unknown names are left as written. */
export function renderText(text: string, vars: Record<string, string>): string {
  return text.replace(VARIABLE, (match, name: string) => vars[name] ?? match);
}

/** Variables used in the wording that the message does not supply. */
export function unknownVariables(text: string, allowed: readonly string[]): string[] {
  const unknown = new Set<string>();
  for (const [, name] of text.matchAll(VARIABLE)) if (!allowed.includes(name!)) unknown.add(name!);
  return [...unknown];
}

// ─── SMS: GSM-7 so one segment holds 160 characters ─────────────────────
// One character outside the GSM-7 alphabet makes the whole SMS UCS-2, which
// holds only 70 characters per segment, so text is normalised first.

const GSM_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);
// Each of these takes two characters of the 160
const GSM_EXTENDED = new Set("^{}\\[~]|€");

// Typographic characters → GSM equivalents (written as code points: several are invisible)
const REPLACEMENTS: Record<string, string> = Object.fromEntries(
  [
    [0x2018, "'"], // left single quote
    [0x2019, "'"], // right single quote / apostrophe
    [0x201c, '"'],
    [0x201d, '"'],
    [0x2013, "-"], // en dash
    [0x2014, "-"], // em dash
    [0x2026, "..."],
    [0x00a0, " "], // no-break space
    [0x202f, " "], // narrow no-break space
    [0x2009, " "], // thin space
    [0x09, " "], // tab
  ].map(([code, to]) => [String.fromCharCode(code as number), to as string]),
);

/** Rewrites text into the GSM-7 alphabet: "Zoë’s" → "Zoe's". */
export function toGsm(text: string): string {
  let out = "";
  for (const ch of text) {
    if (GSM_BASIC.has(ch) || GSM_EXTENDED.has(ch)) out += ch;
    else if (REPLACEMENTS[ch] !== undefined) out += REPLACEMENTS[ch];
    else {
      // Drop accents the alphabet lacks: ë → e, ç → c
      const plain = ch.normalize("NFD").replace(/\p{M}/gu, "");
      out += [...plain].every((c) => GSM_BASIC.has(c)) ? plain : "?";
    }
  }
  return out;
}

export function gsmLength(text: string): number {
  let n = 0;
  for (const ch of text) n += GSM_EXTENDED.has(ch) ? 2 : 1;
  return n;
}

/** Variables that may be shortened to make an SMS fit; amounts, references and links never are. */
const TRIMMABLE = ["name", "unit", "reason", "agent_name", "title", "status", "document", "tenant", "agency"];

/**
 * The SMS text for a template: GSM-7, within 160 characters if at all
 * possible. Long names and reasons are shortened first; the opt-out link
 * (D39) is added when it still fits, and left out rather than splitting
 * the message (it is always in emails and the portal).
 */
export function fitSms(template: string, vars: Record<string, string>, optOutSuffix: string | null): { text: string; optOutIncluded: boolean } {
  const values = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, toGsm(v)]));
  const render = () => toGsm(renderText(template, values));
  let text = render();
  const suffix = optOutSuffix ? toGsm(optOutSuffix) : null;
  if (suffix && gsmLength(text) + gsmLength(suffix) <= SMS_LIMIT) return { text: text + suffix, optOutIncluded: true };
  // Shorten the longest trimmable value, a little at a time, down to 8 characters
  while (gsmLength(text) > SMS_LIMIT) {
    const longest = TRIMMABLE.filter((k) => template.includes(`{${k}}`) && (values[k]?.length ?? 0) > 8).sort(
      (a, b) => values[b]!.length - values[a]!.length,
    )[0];
    if (!longest) break;
    const v = values[longest]!;
    const cut = Math.max(8, v.length - (gsmLength(text) - SMS_LIMIT));
    // Prefer to end on a whole word
    const head = v.slice(0, cut);
    const space = head.lastIndexOf(" ");
    values[longest] = (space >= Math.max(8, cut - 12) ? head.slice(0, space) : head).trimEnd();
    text = render();
  }
  return { text, optOutIncluded: false };
}

// ─── Money and names ───────────────────────────────────────────────────

const zar = new Intl.NumberFormat("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// en-ZA groups thousands with no-break spaces, which are not in the GSM alphabet
const NO_BREAK_SPACES = new RegExp(`[${String.fromCharCode(0xa0)}${String.fromCharCode(0x202f)}]`, "g");

/** 850000 → "8 500,00" with plain spaces, for "R{amount}" in message wording. */
export function messageMoney(cents: number): string {
  return zar.format(Math.abs(cents) / 100).replace(NO_BREAK_SPACES, " ");
}

/** A balance for "R{balance}": credit is shown as such rather than as a negative amount. */
export function messageBalance(cents: number): string {
  return cents < 0 ? `0,00 (R${messageMoney(cents)} in credit)` : messageMoney(cents);
}

export const firstName = (fullName: string) => fullName.trim().split(/\s+/)[0] ?? fullName;

/**
 * A South African or international number in the form SMS gateways expect
 * (27821234567), or null if it cannot be one.
 */
export function toMsisdn(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.trim().replace(/[\s\-().]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else if (/^0\d{9}$/.test(digits)) digits = `27${digits.slice(1)}`;
  if (!/^[1-9]\d{9,14}$/.test(digits)) return null;
  // South African numbers have 9 digits after the country code
  if (digits.startsWith("27") && digits.length !== 11) return null;
  return digits;
}

// ─── Quiet hours (spec: per agency, default 20:00 to 07:00 SAST) ───────

// South Africa has no daylight saving: SAST is always UTC+2
const SAST_OFFSET_MINUTES = 120;
const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
};

/**
 * The earliest time at or after `at` that is outside the agency's quiet
 * hours. Times are "HH:MM" or "HH:MM:SS" in SAST; equal start and end mean
 * no quiet hours.
 */
export function outsideQuietHours(at: Date, start: string, end: string): Date {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) return at;
  const local = new Date(at.getTime() + SAST_OFFSET_MINUTES * 60_000);
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  const quiet = s > e ? minute >= s || minute < e : minute >= s && minute < e;
  if (!quiet) return at;
  // Wait until `end` today, or tomorrow if `end` has already passed today
  const days = minute >= e ? 1 : 0;
  const endLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + days, Math.floor(e / 60), e % 60);
  return new Date(endLocal - SAST_OFFSET_MINUTES * 60_000);
}

// ─── Email ─────────────────────────────────────────────────────────────

export interface EmailBrand {
  agencyName: string;
  colour: string;
  logoUrl: string | null;
  /** Legal footer lines (D60): legal name, registration, FFC, VAT, address, phone, email */
  footer: string[];
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const URL_RE = /\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)"']/g;

function linkify(escaped: string): string {
  return escaped.replace(URL_RE, (url) => `<a href="${url}" style="color:inherit">${url}</a>`);
}

/** The branded HTML and plain-text versions of an email body (D50). */
export function renderEmail(brand: EmailBrand, body: string, optOutUrl: string | null): { html: string; text: string } {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px">${linkify(escapeHtml(p)).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const footer = brand.footer.map((l) => escapeHtml(l)).join("<br>");
  const optOut = optOutUrl
    ? `<p style="margin:12px 0 0">You receive these messages as a tenant of ${escapeHtml(brand.agencyName)}. <a href="${optOutUrl}" style="color:inherit">Stop these emails</a>.</p>`
    : "";
  const header = brand.logoUrl
    ? `<img src="${brand.logoUrl}" alt="${escapeHtml(brand.agencyName)}" style="max-height:56px;max-width:220px">`
    : `<strong style="font-size:18px">${escapeHtml(brand.agencyName)}</strong>`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-top:4px solid ${brand.colour};font-family:Arial,Helvetica,sans-serif;color:#18181b;font-size:15px;line-height:1.5">
<tr><td style="padding:24px 32px 8px">${header}</td></tr>
<tr><td style="padding:16px 32px 8px">${paragraphs}</td></tr>
<tr><td style="padding:16px 32px 24px;border-top:1px solid #e4e4e7;color:#71717a;font-size:12px;line-height:1.5">${footer}${optOut}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [body, "", "--", ...brand.footer, ...(optOutUrl ? ["", `Stop these emails: ${optOutUrl}`] : [])].join("\n");
  return { html, text };
}
