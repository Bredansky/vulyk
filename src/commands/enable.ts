import { findManifest, readManifest, writeManifest } from "../lib/manifest.js";
import { log } from "../lib/log.js";
import { getEntry, setEnabled } from "../lib/groups.js";

export function enableCommand(name: string): void {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);
  const entry = getEntry(manifest, name);
  if (!entry) {
    log.error(`"${name}" not found in vulyk.json.`);
    process.exit(1);
  }

  setEnabled(manifest, name, true);
  writeManifest(manifestPath, manifest);
  log.success(`Enabled "${name}"`);
}
