import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  outDir: "dist",
  clean: true,
  dts: false,
  splitting: false,
  target: "node22",
  banner: { js: "#!/usr/bin/env node" },
});
