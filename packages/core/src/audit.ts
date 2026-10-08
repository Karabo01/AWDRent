import { schema, type Tx } from "@awdrent/db";

export interface AuditEntry {
  /** Dotted verb, e.g. "lease.created", "owner.bank_details_revealed". */
  action: string;
  /** Table or domain name, e.g. "lease". */
  entity: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/**
 * Writes an audit row inside the caller's transaction, so the change and its
 * record commit or roll back together. Who and when come from the transaction
 * context (a database trigger), not from here.
 */
export async function audit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.insert(schema.auditLog).values({
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    before: entry.before ? redact(entry.before) : null,
    after: entry.after ? redact(entry.after) : null,
  });
}

const SECRET_KEYS = new Set(["password", "token", "tokenHash", "secret"]);

/**
 * Keeps encrypted and secret values out of the audit log. Fields named *Enc
 * become "[encrypted]" (their *Last4 sibling still shows what changed).
 */
export function redact(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key.endsWith("Enc") || key.endsWith("BlindIndex")) out[key] = value == null ? null : "[encrypted]";
    else if (SECRET_KEYS.has(key)) out[key] = "[redacted]";
    else if (value instanceof Date) out[key] = value.toISOString();
    else out[key] = value;
  }
  return out;
}

/** Only the fields that differ, for compact update entries. */
export function changes(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (key === "updatedAt") continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      b[key] = before[key];
      a[key] = after[key];
    }
  }
  return { before: b, after: a };
}
