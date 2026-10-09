/* global process, console */
// drizzle-kit writes foreign keys before the unique indexes they reference,
// which Postgres refuses for composite (agency_id, id) keys (D13). This moves
// every CREATE UNIQUE INDEX in a generated migration to just before its first
// foreign key. Usage: node scripts/order-migration.mjs migrations/0041_x.sql
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
if (!file) throw new Error("usage: order-migration.mjs <migration.sql>");
const statements = readFileSync(file, "utf8").split("--> statement-breakpoint");
const isUnique = (s) => /^\s*CREATE UNIQUE INDEX/i.test(s);
const isForeignKey = (s) => /ADD CONSTRAINT .* FOREIGN KEY/i.test(s);
const unique = statements.filter(isUnique);
const rest = statements.filter((s) => !isUnique(s));
const at = rest.findIndex(isForeignKey);
if (unique.length === 0 || at === -1) process.exit(0);
const ordered = [...rest.slice(0, at), ...unique.map((s) => `\n${s.trim()}`), ...rest.slice(at)];
writeFileSync(file, ordered.join("--> statement-breakpoint"));
console.log(`moved ${unique.length} unique index(es) before the first foreign key`);
