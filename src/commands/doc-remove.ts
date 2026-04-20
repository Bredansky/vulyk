import { findManifest, readManifest, writeManifest } from "../lib/manifest.js";
import { log } from "../lib/log.js";

export function docRemoveCommand(name: string): void {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found. Run `vulyk init` first.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);
  if (!manifest.docs.entries[name]) {
    log.error(`Doc "${name}" not found`);
    process.exit(1);
  }

  const { [name]: _, ...remainingDocs } = manifest.docs.entries;
  manifest.docs.entries = remainingDocs;
  writeManifest(manifestPath, manifest);
  log.success(`Removed doc "${name}"`);
}
