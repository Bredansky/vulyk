import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/config.ts"],
  format: ["esm"],
  outDir: "dist",
  clean: true,
  dts: true,
  splitting: false,
  target: "node22",
  banner: { js: "#!/usr/bin/env node" },
});
