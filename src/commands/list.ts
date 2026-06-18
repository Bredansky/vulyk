import * as path from "node:path";
import { findManifest, readManifest } from "../lib/manifest.js";
import { isEnabled } from "../lib/whitelist.js";
import { color, log } from "../lib/log.js";
import { isRemoteDocSource, validateDocsManifest } from "../lib/docs.js";
import { isLocalSkillSource, validateSkillsManifest } from "../lib/skills.js";

export function listCommand(): void {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);
  const projectRoot = path.dirname(manifestPath);
  validateSkillsManifest(manifest, projectRoot);
  validateDocsManifest(manifest, projectRoot);

  const skills = Object.entries(manifest.entries).filter(
    ([, entry]) => entry.type === "skill",
  );
  const docs = Object.entries(manifest.entries).filter(
    ([, entry]) => entry.type === "doc",
  );

  log.blue("\nSkills:");
  if (skills.length === 0) {
    log.dim("  none");
  } else {
    for (const [name, entry] of skills) {
      const status = isEnabled(manifest, name)
        ? color.green("+")
        : color.red("-");
      log.print(
        `  ${status} ${name} ${color.dim(isLocalSkillSource(projectRoot, entry.source) ? "local" : "external")} ${color.dim(entry.source)}`,
      );
    }
  }

  if (docs.length > 0) {
    log.blue("\nDocs:");
    for (const [name, entry] of docs) {
      if (entry.type !== "doc") continue;
      log.print(
        `  ${color.green("+")} ${name} ${color.dim(isRemoteDocSource(projectRoot, entry.source) ? "external" : "local")} ${color.dim(entry.source)} ${color.dim(`-> ${entry.targets.join(", ")}`)}`,
      );
    }
  }

  log.blue("\nPaths:");
  if (
    manifest.skillOutputPaths.length === 0 &&
    Object.keys(manifest.docRules).length === 0
  ) {
    log.dim("  none");
  } else {
    if (manifest.skillOutputPaths.length > 0) {
      log.print(
        `  ${color.dim("skill outputs:")} ${manifest.skillOutputPaths.join(", ")}`,
      );
    }
    if (Object.keys(manifest.docRules).length > 0) {
      log.print(
        `  ${color.dim("doc rules:")} ${Object.keys(manifest.docRules).join(", ")}`,
      );
    }
  }
  log.print("");
}
