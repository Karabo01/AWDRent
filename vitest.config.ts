import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/**/src/**/*.test.ts", "apps/**/src/**/*.test.ts"],
          exclude: ["**/node_modules/**"],
          environment: "node",
        },
      },
      {
        test: {
          name: "integration",
          include: ["packages/**/test/**/*.test.ts", "apps/**/test/**/*.test.ts"],
          exclude: ["**/node_modules/**"],
          environment: "node",
          globalSetup: ["packages/db/test/global-setup.ts"],
          setupFiles: ["packages/db/test/load-env.ts"],
          // Tests share one database; run files one at a time
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
