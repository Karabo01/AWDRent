import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, ownerDb } from "./client";

export const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

export async function runMigrations(): Promise<void> {
  await migrate(ownerDb(), { migrationsFolder });
}

// CLI: `npm run db:migrate`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runMigrations()
    .then(() => console.log("[migrate] done"))
    .catch((err: unknown) => {
      console.error("[migrate] failed", err);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
