import { index, jsonb, pgEnum, pgTable, text } from "drizzle-orm/pg-core";
import { agencyColumn, createdBy, pk, timestamps } from "./_columns";
import { agencies } from "./agencies";

export const importStatus = pgEnum("import_status", ["completed", "failed"]);

/** One attempt to import an agency's spreadsheets (decision D26). */
export const importJobs = pgTable(
  "import_jobs",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    status: importStatus().notNull(),
    fileNames: text().array().notNull(),
    // { owners: 12, properties: 10, ... }
    counts: jsonb().notNull(),
    // Row errors for a failed import (no cell values, so no personal data)
    errors: jsonb(),
    ...timestamps,
    createdBy: createdBy(),
  },
  (t) => [index("import_jobs_agency_created_idx").on(t.agencyId, t.createdAt)],
);
