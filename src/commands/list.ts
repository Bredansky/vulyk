import { findManifest, readManifest } from "../lib/manifest.js";
import { isEnabled } from "../lib/whitelist.js";
import { color, log } from "../lib/log.js";

export function listCommand(): void {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);
  const skills = Object.entries(manifest.skills.entries);
  const docs = Object.entries(manifest.docs.entries);

  log.blue("\nSkills:");
  if (skills.length === 0) {
    log.dim("  none");
  } else {
    for (const [name, specifier] of skills) {
      const status = isEnabled(manifest, name)
        ? color.green("✓")
        : color.red("✗");
      const atIdx = specifier.lastIndexOf("@");
      const version =
        atIdx > 0 ? color.dim(specifier.slice(atIdx)) : color.dim("@HEAD");
      log.print(`  ${status} ${name} ${version}`);
    }
  }

  if (docs.length > 0) {
    log.blue("\nExternal Docs:");
    for (const [name, entry] of docs) {
      const atIdx = entry.source.lastIndexOf("@");
      const version =
        atIdx > 0 ? color.dim(entry.source.slice(atIdx)) : color.dim("@HEAD");
      log.print(
        `  ${color.green("✓")} ${name} ${version} ${color.dim(`→ ${entry.targets.join(", ")}`)}`,
      );
    }
  }

  log.blue("\nPaths:");
  if (!manifest.skills.path && !manifest.docs.path) {
    log.dim("  none");
  } else {
    if (manifest.skills.path) {
      log.print(`  ${color.dim("skills:")} ${manifest.skills.path}`);
    }
    if (manifest.docs.path) {
      log.print(`  ${color.dim("docs:")} ${manifest.docs.path}`);
    }
  }
  log.print("");
}
