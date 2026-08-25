import * as fs from "node:fs";
import * as path from "node:path";
import { register } from "tsx/cjs/api";
import { ManifestSchema, type Manifest } from "../types.js";
import { writeTextFile } from "./text.js";

export const CONFIG_FILE = "vulyk.config.ts";

export function findManifest(): string | null {
  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, CONFIG_FILE);
    if (fs.existsSync(candidate)) {
      process.chdir(dir);
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function readManifest(filePath: string): Manifest {
  const scope = register({
    namespace: `vulyk-config-${String(Date.now())}-${String(Math.random())}`,
  });
  try {
    const module: unknown = scope.require(
      path.resolve(filePath),
      import.meta.url,
    );
    if (!isConfigModule(module)) {
      throw new Error(`${CONFIG_FILE} must export a default config.`);
    }
    return ManifestSchema.parse(module.default ?? module.config);
  } finally {
    scope.unregister();
  }
}

export function writeManifest(filePath: string, manifest: Manifest): void {
  const tmp = `${filePath}.tmp`;
  const body = JSON.stringify(manifest, null, 2);
  writeTextFile(
    tmp,
    `import type { VulykConfig } from "vulyk/config";\n\nconst defineConfig = (config: VulykConfig): VulykConfig => config;\n\nexport default defineConfig(${body});\n`,
  );
  fs.renameSync(tmp, filePath);
}

export function initManifest(filePath: string): Manifest {
  const manifest = ManifestSchema.parse({});
  writeManifest(filePath, manifest);
  return manifest;
}

function isConfigModule(
  value: unknown,
): value is { default?: unknown; config?: unknown } {
  return typeof value === "object" && value !== null;
}
