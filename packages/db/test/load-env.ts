import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Integration tests run against TEST_DATABASE_NAME on the same server as dev,
// using the same four roles. Every DATABASE_*_URL is rewritten to point there.

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const testDb = process.env.TEST_DATABASE_NAME ?? "awdrent_test";
for (const key of ["DATABASE_URL", "DATABASE_AUTH_URL", "DATABASE_PLATFORM_URL", "DATABASE_OWNER_URL"]) {
  const value = process.env[key];
  if (!value) continue;
  const url = new URL(value);
  url.pathname = `/${testDb}`;
  process.env[key] = url.toString();
}
process.env.NODE_ENV = "test";
