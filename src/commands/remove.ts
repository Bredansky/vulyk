import * as path from "node:path";
import { findManifest, readManifest, writeManifest } from "../lib/manifest.js";
import { uninstall } from "../lib/installer.js";
import { log } from "../lib/log.js";
import { getPreservedLocalSkillPaths } from "../lib/skills.js";

export function removeCommand(name: string): void {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);
  const projectRoot = path.dirname(manifestPath);
  if (!manifest.skills.entries[name]) {
    log.error(`"${name}" not found`);
    process.exit(1);
  }

  uninstall(name, manifest.skills.outputPaths, {
    preservePaths: getPreservedLocalSkillPaths(
      projectRoot,
      name,
      manifest.skills.entries[name].source,
      manifest.skills.outputPaths,
    ),
  });
  const { [name]: _, ...remainingSkills } = manifest.skills.entries;
  manifest.skills.entries = remainingSkills;
  writeManifest(manifestPath, manifest);
  log.success(`Removed "${name}"`);
}
