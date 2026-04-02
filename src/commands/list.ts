import { findManifest, readManifest } from "../lib/manifest.js";
import { isEnabled } from "../lib/whitelist.js";
import { color, log } from "../lib/log.js";

export function listCommand(): void {
  const manifestPath = findManifest();
  if (!manifestPath) { log.error("No vulyk.json found."); process.exit(1); }

  const manifest = readManifest(manifestPath);
  const skills = Object.entries(manifest.skills);
  const docs = Object.entries(manifest.docs);

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

  if (docs.length > 0) {
    log.blue("\nExternal Docs:");
    for (const [name, entry] of docs) {
      const atIdx = entry.source.lastIndexOf("@");
      const version = atIdx > 0 ? color.dim(entry.source.slice(atIdx)) : color.dim("@HEAD");
      console.log(`  ${color.green("✓")} ${name} ${version} ${color.dim(`→ ${entry.targets.join(", ")}`)}`);
    }
  }

  log.blue("\nPaths:");
  const skillPaths = manifest.paths.skills;
  const docPaths = manifest.paths.docs;
  if (skillPaths.length === 0 && docPaths.length === 0) {
    log.dim("  none");
  } else {
    if (skillPaths.length > 0) console.log(`  ${color.dim("skills:")} ${skillPaths.join(", ")}`);
    if (docPaths.length > 0) console.log(`  ${color.dim("docs:")} ${docPaths.join(", ")}`);
  }
  console.log("");
}
