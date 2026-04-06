import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { findManifest, readManifest, writeManifest } from "../lib/manifest.js";
import { parseSource, fetchSource } from "../lib/fetcher.js";
import { detect } from "../lib/detector.js";
import { install } from "../lib/installer.js";
import { isEnabled } from "../lib/whitelist.js";
import { type Manifest } from "../types.js";
import { log } from "../lib/log.js";
import { pinSpecifier, stripPinnedRef } from "../lib/specifier.js";

function getPrimarySkillOutputPath(manifest: Manifest): string {
  return manifest.skills.outputPaths[0] ?? "skills";
}

function addSingle(
  specifier: string,
  tmpDir: string,
  commit: string | null,
  manifest: Manifest,
): void {
  const installedName = install(specifier, tmpDir, manifest.skills.outputPaths);
  manifest.skills.entries[installedName] = {
    source: commit
      ? pinSpecifier(specifier, commit)
      : stripPinnedRef(specifier),
  };
  if (!isEnabled(manifest, installedName)) {
    log.warn(
      `"${installedName}" added but not in enabled whitelist -- won't install on sync`,
    );
  }
  log.success(
    `Added "${installedName}" -> ${getPrimarySkillOutputPath(manifest)}`,
  );
}

export async function addCommand(
  specifier: string,
  opts: { name?: string },
): Promise<void> {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found. Run `vulyk init` first.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);
  if (manifest.skills.outputPaths.length === 0) {
    log.warn("No skill outputPaths configured in vulyk.json.");
    log.dim(`  Example: "skills": { "outputPaths": ["skills"] }`);
    process.exit(1);
  }

  const name =
    opts.name ??
    specifier.split("/").filter(Boolean).pop()?.replace(/@.*$/, "") ??
    specifier;
  log.info(`Fetching ${name}...`);

  const tmpDir = path.join(os.homedir(), ".vulyk", "tmp", name);
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  let commit: string | null;
  try {
    commit = await fetchSource(parseSource(specifier), tmpDir);
  } catch (err) {
    log.error(
      `Failed to fetch: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  const detection = detect(tmpDir);

  if (detection.type === "skill") {
    addSingle(specifier, tmpDir, commit, manifest);
  } else {
    const skills = detection.skills ?? [];
    if (skills.length === 0) {
      log.error("No skills found at this path.");
      fs.rmSync(tmpDir, { recursive: true, force: true });
      process.exit(1);
    }
    log.info(`Found ${String(skills.length)} skills: ${skills.join(", ")}`);
    for (const skillName of skills) {
      const skillSpecifier = `${stripPinnedRef(specifier)}/${skillName}`;
      addSingle(skillSpecifier, path.join(tmpDir, skillName), commit, manifest);
    }
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
  writeManifest(manifestPath, manifest);
}
