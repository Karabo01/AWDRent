import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/next-env.d.ts", "packages/db/migrations/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // Tenant data must go through withAgency(); only the db package may touch the raw pools.
    files: ["apps/**/*.{ts,tsx}", "packages/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["pg", "@awdrent/db/src/*", "**/db/src/pool*"], message: "Use withAgency()/withPlatform() from @awdrent/db." },
          ],
        },
      ],
    },
  },
);
