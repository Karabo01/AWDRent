// The one place that says which staff role may do what (decision D8).
// Every server action and route handler checks here; the UI uses the same
// function only to hide controls. Agency isolation is separate: it is
// enforced by the database (RLS), not here.
//
// Agents are further limited to the properties in their portfolio; see
// portfolio.ts. "Scoped" actions below are portfolio-limited for agents.

export type StaffRole = "admin" | "agent" | "accounts";

export type Action =
  | "settings.manage"
  | "staff.manage"
  | "audit.view"
  | "portfolio.assign"
  | "records.view" // owners, properties, units, tenants, leases (scoped)
  | "records.edit" // create/update the same (scoped)
  | "owner.bank.view" // unmasked owner bank account (D6)
  | "owner.bank.edit"
  | "tenant.id.view" // unmasked tenant ID number (scoped)
  | "documents.view" // (scoped)
  | "documents.upload" // (scoped)
  | "documents.delete"
  | "import.run";

const MATRIX: Record<Action, readonly StaffRole[]> = {
  "settings.manage": ["admin"],
  "staff.manage": ["admin"],
  "audit.view": ["admin"],
  "portfolio.assign": ["admin"],
  "records.view": ["admin", "agent", "accounts"],
  "records.edit": ["admin", "agent"],
  "owner.bank.view": ["admin"],
  "owner.bank.edit": ["admin"],
  "tenant.id.view": ["admin", "agent"],
  "documents.view": ["admin", "agent", "accounts"],
  "documents.upload": ["admin", "agent"],
  "documents.delete": ["admin"],
  "import.run": ["admin"],
};

export function can(role: StaffRole, action: Action): boolean {
  return MATRIX[action].includes(role);
}

export class ForbiddenError extends Error {
  constructor(action: Action) {
    super(`Not allowed: ${action}`);
    this.name = "ForbiddenError";
  }
}

export function assertCan(role: StaffRole, action: Action): void {
  if (!can(role, action)) throw new ForbiddenError(action);
}

/** Support sessions are always treated as admin, but writes still need write access (DB-enforced). */
export function isScopedToPortfolio(role: StaffRole): boolean {
  return role === "agent";
}
