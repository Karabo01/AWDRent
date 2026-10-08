import { date, integer, pgTable, uniqueIndex } from "drizzle-orm/pg-core";
import { agencyColumn, pk, timestamps } from "./_columns";
import { agencies } from "./agencies";

/**
 * Monthly usage per agency, the basis for its invoice. Written by the worker
 * inside each agency's context; read across agencies by the platform console.
 */
export const usageCounters = pgTable(
  "usage_counters",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    // First day of the month
    month: date().notNull(),
    activeUnits: integer().notNull().default(0),
    smsSent: integer().notNull().default(0),
    emailsSent: integer().notNull().default(0),
    whatsappSent: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex("usage_counters_agency_month_key").on(t.agencyId, t.month)],
);
