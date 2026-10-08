import { foreignKey, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { agencyColumn, pk, tstz } from "./_columns";
import { agencies } from "./agencies";
import { supportSessions } from "./platform";
import { portalUsers } from "./portal";
import { users } from "./staff";

/**
 * Append-only record of changes to money, leases, applications and other
 * agency records. A trigger fills user_id, support_session_id and created_at
 * from the transaction context, so callers cannot set them.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    userId: uuid(),
    supportSessionId: uuid().references(() => supportSessions.id),
    // A tenant acting in the portal (D76)
    portalUserId: uuid(),
    // e.g. "lease.created", "owner.bank_details_revealed"
    action: text().notNull(),
    entity: text().notNull(),
    entityId: uuid(),
    // Encrypted fields are replaced with "[encrypted]" before writing
    before: jsonb(),
    after: jsonb(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_agency_entity_idx").on(t.agencyId, t.entity, t.entityId),
    index("audit_log_agency_created_idx").on(t.agencyId, t.createdAt),
    foreignKey({ name: "audit_log_portal_user_fk", columns: [t.agencyId, t.portalUserId], foreignColumns: [portalUsers.agencyId, portalUsers.id] }),
    foreignKey({
      name: "audit_log_user_fk",
      columns: [t.agencyId, t.userId],
      foreignColumns: [users.agencyId, users.id],
    }),
  ],
);
