import { defineConfig } from "tsup";

// Bundle the workspace packages (shipped as TS source) into one file;
// third-party dependencies stay external and come from node_modules.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  sourcemap: true,
  clean: true,
  noExternal: [/^@awdrent\//],
});
