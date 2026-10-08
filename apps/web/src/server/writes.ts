import "server-only";
import type { FormState } from "./forms";
import type { StaffSession } from "./session";

const READ_ONLY_MESSAGE = "This support session is read-only. Enable write access in the platform console first.";

/**
 * Friendly early answer for read-only support sessions. The database would
 * refuse the write anyway (READ ONLY transaction); this just says why.
 */
export function writeGuard(s: StaffSession): FormState | null {
  return s.ctx.readOnly ? { error: READ_ONLY_MESSAGE } : null;
}

/** Maps Postgres "read-only transaction" (25006) to a form error; null for anything else. */
export function readOnlyError(err: unknown): FormState | null {
  const code = (err as { cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;
  return code === "25006" ? { error: READ_ONLY_MESSAGE } : null;
}
