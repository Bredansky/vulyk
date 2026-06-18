import { findManifest, readManifest, writeManifest } from "../lib/manifest.js";
import { log } from "../lib/log.js";

export function removeCommand(name: string): void {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found. Run `vulyk init` first.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);

  if (!manifest.entries[name]) {
    log.error(`"${name}" not found in vulyk.json.`);
    process.exit(1);
  }

  const { [name]: _, ...remainingEntries } = manifest.entries;
  manifest.entries = remainingEntries;
  writeManifest(manifestPath, manifest);
  log.success(`Removed "${name}"`);
}
