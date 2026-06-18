import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { findManifest, readManifest, writeManifest } from "../lib/manifest.js";
import { install, uninstall } from "../lib/installer.js";
import { parseSource, fetchSource } from "../lib/fetcher.js";
import { log } from "../lib/log.js";
import {
  getPreservedLocalSkillPaths,
  isLocalSkillSource,
  resolveSkillSourcePath,
  validateSkillsManifest,
} from "../lib/skills.js";

export async function enableCommand(name: string): Promise<void> {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);
  const projectRoot = path.dirname(manifestPath);
  validateSkillsManifest(manifest, projectRoot);

  const entry = manifest.entries[name];
  if (entry?.type !== "skill") {
    log.error(`"${name}" not found or is not a skill`);
    process.exit(1);
  }

  if (!manifest.enabled) {
    log.warn(
      `No whitelist defined — all skills already enabled. Add "enabled": [] to use a whitelist.`,
    );
    return;
  }

  if (!manifest.enabled.includes(name)) {
    manifest.enabled.push(name);
    writeManifest(manifestPath, manifest);
  }

  if (isLocalSkillSource(projectRoot, entry.source)) {
    const sourcePath = resolveSkillSourcePath(projectRoot, entry.source);
    install(name, sourcePath, manifest.skillOutputPaths, {
      preservePaths: getPreservedLocalSkillPaths(
        projectRoot,
        name,
        entry.source,
        manifest.skillOutputPaths,
      ),
    });
    log.success(`Enabled "${name}"`);
    return;
  }

  const tmpDir = path.join(os.homedir(), ".vulyk", "tmp", name);
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  await fetchSource(parseSource(entry.source), tmpDir);
  install(name, tmpDir, manifest.skillOutputPaths);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  log.success(`Enabled "${name}"`);
}

export function disableCommand(name: string): void {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);
  validateSkillsManifest(manifest, path.dirname(manifestPath));

  const entry = manifest.entries[name];
  if (entry?.type !== "skill") {
    log.error(`"${name}" not found or is not a skill`);
    process.exit(1);
  }

  manifest.enabled = manifest.enabled
    ? manifest.enabled.filter((n) => n !== name)
    : Object.keys(manifest.entries)
        .filter((k) => manifest.entries[k].type === "skill")
        .filter((n) => n !== name);

  writeManifest(manifestPath, manifest);
  uninstall(name, manifest.skillOutputPaths, {
    preservePaths: getPreservedLocalSkillPaths(
      path.dirname(manifestPath),
      name,
      entry.source,
      manifest.skillOutputPaths,
    ),
  });
  log.success(`Disabled "${name}"`);
}
