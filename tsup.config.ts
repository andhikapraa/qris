import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", cli: "src/cli.ts" },
  format: ["esm", "cjs"],
  dts: { entry: { index: "src/index.ts" } },
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: "node18",
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
});
