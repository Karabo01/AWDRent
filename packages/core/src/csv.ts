// Writing CSV files for banks and spreadsheets. Values starting with = + - @
// or a tab are prefixed with an apostrophe, so a tenant's name or reference
// can never run as a formula when the file is opened in Excel (CSV injection).
// Numbers are written as numbers, so negative amounts stay negative.

export type CsvValue = string | number | null | undefined;

export function csvField(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  let s = value.replace(/\r\n?/g, "\n");
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows to CSV text with CRLF line ends, as banks and Excel expect. */
export function toCsv(header: string[], rows: CsvValue[][]): string {
  return [header, ...rows].map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}

/** Cents as rands with two decimals and a dot: 123456 → 1234.56. */
export const csvRands = (cents: number) => (cents / 100).toFixed(2);
