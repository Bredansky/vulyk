import * as fs from "node:fs";
import * as path from "node:path";
import { ManifestSchema, type Manifest } from "../types.js";

export const MANIFEST_FILE = "vulyk.json";

export function findManifest(): string | null {
  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, MANIFEST_FILE);
    if (fs.existsSync(candidate)) {
      // Anchor the process to the project root. All manifest paths are
      // project-root-relative, and downstream `path.resolve(p)` calls
      // (in resolvePath helpers) are CWD-relative — so we chdir here
      // once and let every subsequent resolver behave correctly.
      // Safe for a CLI: this is a child process, the user's shell is
      // unaffected.
      process.chdir(dir);
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function readManifest(filePath: string): Manifest {
  return ManifestSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

export function writeManifest(filePath: string, manifest: Manifest): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(tmp, filePath);
}

export function initManifest(filePath: string): Manifest {
  // Start with empty groups + entries. Users declare groups,
  // then `vulyk add <source>` auto-detects the right one.
  const manifest = ManifestSchema.parse({});
  writeManifest(filePath, manifest);
  return manifest;
}
