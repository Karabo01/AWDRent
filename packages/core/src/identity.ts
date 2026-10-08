import { normaliseIdentifier } from "./crypto";

/**
 * South African ID number check: 13 digits, a real date of birth, and the
 * Luhn check digit. Passports and registration numbers are not checked here.
 */
export function isValidSaId(input: string): boolean {
  const id = normaliseIdentifier(input);
  if (!/^\d{13}$/.test(id)) return false;
  const mm = Number(id.slice(2, 4));
  const dd = Number(id.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    let d = Number(id[12 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Accepts an SA ID (validated), or a passport / registration number of 5–20 characters. */
export function identityNumberProblem(input: string, kind: "sa_id" | "other"): string | null {
  const v = normaliseIdentifier(input);
  if (kind === "sa_id") return isValidSaId(v) ? null : "That is not a valid South African ID number.";
  return /^[A-Z0-9/]{5,20}$/.test(v) ? null : "Use 5–20 letters, digits or slashes.";
}
