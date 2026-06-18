import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { findManifest, readManifest, writeManifest } from "../lib/manifest.js";
import { parseSource, fetchSource } from "../lib/fetcher.js";
import { detect } from "../lib/detector.js";
import { install } from "../lib/installer.js";
import { isEnabled } from "../lib/whitelist.js";
import { type Manifest, type UnifiedEntry } from "../types.js";
import { log } from "../lib/log.js";
import {
  pinSpecifier,
  stripPinnedRef,
  isRemoteSpecifier,
} from "../lib/specifier.js";
import {
  getPreservedLocalSkillPaths,
  resolveSkillSourcePath,
} from "../lib/skills.js";

function getPrimarySkillOutputPath(manifest: Manifest): string {
  return manifest.skillOutputPaths[0] ?? ".agents/skills";
}

function addSingle(
  specifier: string,
  tmpDir: string,
  commit: string | null,
  manifest: Manifest,
  type: "skill" | "doc",
): string {
  const installedName = install(
    specifier,
    tmpDir,
    type === "skill" ? manifest.skillOutputPaths : [],
  );

  const baseEntry: UnifiedEntry =
    type === "skill"
      ? { type: "skill", source: "" }
      : {
          type: "doc",
          source: "",
          targets: [getPrimarySkillOutputPath(manifest)],
        };

  manifest.entries[installedName] = {
    ...baseEntry,
    source: commit
      ? pinSpecifier(specifier, commit)
      : stripPinnedRef(specifier),
  };

  if (type === "skill" && !isEnabled(manifest, installedName)) {
    log.warn(
      `"${installedName}" added but not in enabled whitelist -- won't install on agents`,
    );
  }

  log.success(`Added "${installedName}"`);
  return installedName;
}

function toRelativePosix(projectRoot: string, value: string): string {
  return path.relative(projectRoot, value).replace(/\\/g, "/");
}

function addLocalSingle(
  sourcePath: string,
  manifest: Manifest,
  projectRoot: string,
  type: "skill" | "doc",
): string {
  const installedName = install(
    sourcePath,
    sourcePath,
    type === "skill" ? manifest.skillOutputPaths : [],
    {
      preservePaths:
        type === "skill"
          ? getPreservedLocalSkillPaths(
              projectRoot,
              sourcePath,
              sourcePath,
              manifest.skillOutputPaths,
            )
          : [],
    },
  );

  const baseEntry: UnifiedEntry =
    type === "skill"
      ? { type: "skill", source: "" }
      : {
          type: "doc",
          source: "",
          targets: [getPrimarySkillOutputPath(manifest)],
        };

  manifest.entries[installedName] = {
    ...baseEntry,
    source: toRelativePosix(projectRoot, sourcePath),
  };

  if (type === "skill" && !isEnabled(manifest, installedName)) {
    log.warn(
      `"${installedName}" added but not in enabled whitelist -- won't install on agents`,
    );
  }

  log.success(`Added "${installedName}"`);
  return installedName;
}

export async function addCommand(
  specifier: string,
  opts: { name?: string; type?: "skill" | "doc" },
): Promise<void> {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found. Run `vulyk init` first.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);
  const projectRoot = path.dirname(manifestPath);

  if (!opts.type && manifest.skillOutputPaths.length === 0) {
    log.warn("No skillOutputPaths configured in vulyk.json.");
    log.dim(`  Example: "skillOutputPaths": [".agents/skills"]`);
    process.exit(1);
  }

  const type = opts.type ?? "skill";

  if (!isRemoteSpecifier(specifier)) {
    const sourcePath = resolveSkillSourcePath(projectRoot, specifier);
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
      log.error(`Local source must be an existing directory: ${specifier}`);
      process.exit(1);
    }

    const detection = detect(sourcePath);
    if (detection.type === "skill") {
      addLocalSingle(sourcePath, manifest, projectRoot, type);
    } else {
      const skills = detection.skills ?? [];
      if (skills.length === 0) {
        log.error("No skills found at this path.");
        process.exit(1);
      }
      log.info(`Found ${String(skills.length)} skills: ${skills.join(", ")}`);
      for (const skillName of skills) {
        addLocalSingle(
          path.join(sourcePath, skillName),
          manifest,
          projectRoot,
          type,
        );
      }
    }

    writeManifest(manifestPath, manifest);
    return;
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
    addSingle(specifier, tmpDir, commit, manifest, type);
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
      addSingle(
        skillSpecifier,
        path.join(tmpDir, skillName),
        commit,
        manifest,
        type,
      );
    }
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
  writeManifest(manifestPath, manifest);
}
