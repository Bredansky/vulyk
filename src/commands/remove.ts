import { findManifest, readManifest, writeManifest } from "../lib/manifest.js";
import { uninstall } from "../lib/installer.js";
import { log } from "../lib/log.js";

export function removeCommand(name: string): void {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);
  if (!manifest.skills.entries[name]) {
    log.error(`"${name}" not found`);
    process.exit(1);
  }

  uninstall(name, manifest.skills.outputPaths);
  const { [name]: _, ...remainingSkills } = manifest.skills.entries;
  manifest.skills.entries = remainingSkills;
  writeManifest(manifestPath, manifest);
  log.success(`Removed "${name}"`);
}
