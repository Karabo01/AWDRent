// Money is integer cents (ZAR); percentages are integer basis points
// (decision D11). Parsing works on the text, never through floats, so
// "R1 234,56" and "1234.56" both become exactly 123456.

const RAND_RE = /^(\d{1,9})(?:[.,](\d{1,2}))?$/;

/** "1 234.50", "R1234,5", "1,234.50" → 123450. Null if not a valid amount. */
export function parseRandToCents(input: string): number | null {
  let s = input.trim().replace(/^R\s*/i, "").replace(/\s/g, "");
  // "1,234.50": comma as thousands separator when a dot decimal follows
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) s = s.replace(/,/g, "");
  const m = RAND_RE.exec(s);
  if (!m) return null;
  const rands = Number(m[1]);
  const cents = Number((m[2] ?? "").padEnd(2, "0"));
  return rands * 100 + cents;
}

const zar = new Intl.NumberFormat("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 123450 → "R 1 234,50" style (South African formatting). */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}R ${zar.format(Math.abs(cents) / 100)}`;
}

/** "10" → 1000, "8.5" → 850, "12,25" → 1225. Null if not 0–100 with ≤2 decimals. */
export function parsePercentToBps(input: string): number | null {
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(input.trim().replace(/%$/, "").trim());
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bps <= 10_000 ? bps : null;
}

/** 1050 → "10.5" (for form fields). */
export function bpsToPercentString(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const frac = String(bps % 100).padStart(2, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}
