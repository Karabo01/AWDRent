import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  casing: "snake_case",
  // Only used by `drizzle-kit studio`/`check`; migrations run through src/migrate.ts
  dbCredentials: { url: process.env.DATABASE_OWNER_URL ?? "" },
});
