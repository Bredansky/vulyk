import * as path from "node:path";
import { findManifest, readManifest } from "../lib/manifest.js";
import { isEnabled } from "../lib/whitelist.js";
import { color, log } from "../lib/log.js";
import { isRemoteDocSource, validateDocsManifest } from "../lib/docs.js";
import { validateSkillsManifest } from "../lib/skills.js";

export function listCommand(): void {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);
  const projectRoot = path.dirname(manifestPath);
  validateSkillsManifest(manifest);
  validateDocsManifest(manifest, projectRoot);
  const skills = Object.entries(manifest.skills.entries);
  const docs = Object.entries(manifest.docs.entries);

  log.blue("\nSkills:");
  if (skills.length === 0) {
    log.dim("  none");
  } else {
    for (const [name, entry] of skills) {
      const status = isEnabled(manifest, name)
        ? color.green("+")
        : color.red("-");
      log.print(`  ${status} ${name} ${color.dim(entry.source)}`);
    }
  }

  if (docs.length > 0) {
    log.blue("\nDocs:");
    for (const [name, entry] of docs) {
      log.print(
        `  ${color.green("+")} ${name} ${color.dim(isRemoteDocSource(projectRoot, entry.source) ? "external" : "local")} ${color.dim(entry.source)} ${color.dim(`-> ${entry.targets.join(", ")}`)}`,
      );
    }
  }

  log.blue("\nPaths:");
  if (
    manifest.skills.outputPaths.length === 0 &&
    Object.keys(manifest.docs.rules).length === 0
  ) {
    log.dim("  none");
  } else {
    if (manifest.skills.outputPaths.length > 0) {
      log.print(
        `  ${color.dim("skill outputs:")} ${manifest.skills.outputPaths.join(", ")}`,
      );
    }
    if (Object.keys(manifest.docs.rules).length > 0) {
      log.print(
        `  ${color.dim("doc rules:")} ${Object.keys(manifest.docs.rules).join(", ")}`,
      );
    }
  }
  log.print("");
}
