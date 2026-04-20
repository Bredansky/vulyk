import * as fs from "node:fs";
import * as path from "node:path";
import type { Manifest } from "../types.js";
import { detect } from "./detector.js";
import { validateRemoteSkillSource } from "./source-validation.js";

export function resolveSkillSourcePath(
  projectRoot: string,
  source: string,
): string {
  return path.resolve(projectRoot, source);
}

export function isLocalSkillSource(
  projectRoot: string,
  source: string,
): boolean {
  return fs.existsSync(resolveSkillSourcePath(projectRoot, source));
}

export function validateSkillsManifest(
  manifest: Manifest,
  projectRoot: string,
): void {
  for (const [name, entry] of Object.entries(manifest.skills.entries)) {
    if (!isLocalSkillSource(projectRoot, entry.source)) {
      validateRemoteSkillSource(name, entry.source);
      continue;
    }

    const sourcePath = resolveSkillSourcePath(projectRoot, entry.source);
    const stat = fs.statSync(sourcePath);
    if (!stat.isDirectory()) {
      throw new Error(
        `Local skill source for "${name}" must be a directory: ${entry.source}`,
      );
    }

    const detection = detect(sourcePath);
    if (detection.type === "skill") {
      continue;
    }

    if ((detection.skills ?? []).length === 0) {
      throw new Error(`Local skill source for "${name}" has no skills.`);
    }
  }
}
