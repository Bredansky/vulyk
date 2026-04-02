import { findManifest, readManifest } from "../lib/manifest.js";
import { isEnabled } from "../lib/whitelist.js";
import { color, log } from "../lib/log.js";

export function listCommand(): void {
  const manifestPath = findManifest();
  if (!manifestPath) { log.error("No vulyk.json found."); process.exit(1); }

  const manifest = readManifest(manifestPath);
  const skills = Object.entries(manifest.skills);

  log.blue("\nSkills:");
  if (skills.length === 0) {
    log.dim("  none");
  } else {
    for (const [name, specifier] of skills) {
      const status = isEnabled(manifest, name) ? color.green("✓") : color.red("✗");
      const atIdx = specifier.lastIndexOf("@");
      const version = atIdx > 0 ? color.dim(specifier.slice(atIdx)) : color.dim("@HEAD");
      console.log(`  ${status} ${name} ${version}`);
    }
  }

  log.blue("\nPaths:");
  if (manifest.paths.length === 0) {
    log.dim("  none");
  } else {
    for (const p of manifest.paths) console.log(`  ${color.dim(p)}`);
  }
  console.log("");
}
