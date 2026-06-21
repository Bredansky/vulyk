import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { findManifest, readManifest, writeManifest } from "../lib/manifest.js";
import { parseSource, fetchSource } from "../lib/fetcher.js";
import { install, uninstall } from "../lib/installer.js";
import {
  getEntry,
  isEnabled,
  resolveOutputPaths,
  resolveGitignoreGenerated,
} from "../lib/groups.js";
import { log } from "../lib/log.js";
import { pinSpecifier } from "../lib/specifier.js";
import { cleanupStale } from "../lib/cleanup.js";
import type { Manifest } from "../types.js";

function isLocalSource(projectRoot: string, source: string): boolean {
  return fs.existsSync(path.resolve(projectRoot, source));
}

/**
 * Sync one entry: install from source into the configured output paths.
 * No agent-file generation happens here — that lives in `agentsCommand`.
 */
async function syncEntry(
  name: string,
  projectRoot: string,
  manifest: Manifest,
): Promise<string | undefined> {
  const entry = getEntry(manifest, name);
  if (!entry) return undefined;

  if (!isEnabled(manifest, name)) {
    const outPaths = resolveOutputPaths(manifest, name);
    const isLocal = isLocalSource(projectRoot, entry.source);
    const sourceIsDir = isLocal
      ? fs.statSync(path.resolve(projectRoot, entry.source)).isDirectory()
      : true;
    uninstall(name, outPaths, { isDir: sourceIsDir });
    log.dim(`  skipped ${name} (disabled)`);
    return undefined;
  }

  const outPaths = resolveOutputPaths(manifest, name);
  const explicitGitignore = resolveGitignoreGenerated(manifest, name);
  // undefined → install function uses per-path heuristic
  const gitignore = explicitGitignore;
  const sourceIsLocal = isLocalSource(projectRoot, entry.source);

  let updatedSource: string | undefined;

  if (sourceIsLocal) {
    const sourcePath = path.resolve(projectRoot, entry.source);
    install(name, sourcePath, outPaths, {
      gitignore,
      preservePaths: [sourcePath],
      // Local sources: preserve the folder shape even if the directory
      // contains a single file (the user chose that structure).
      preserveFolderForSingleFile: true,
    });
  } else {
    const tmpDir = path.join(os.homedir(), ".vulyk", "tmp", name);
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    try {
      const commit = await fetchSource(parseSource(entry.source), tmpDir);
      install(name, tmpDir, outPaths, { gitignore });
      fs.rmSync(tmpDir, { recursive: true, force: true });
      updatedSource = commit
        ? pinSpecifier(entry.source, commit)
        : entry.source;
    } catch (err) {
      log.error(
        `Failed to sync "${name}": ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  }

  log.success(name);
  return updatedSource;
}

/**
 * Sync every enabled entry: install from source, refresh gitignore, prune
 * stale managed files. Does NOT generate agent files (AGENTS.md/CLAUDE.md) —
 * that's `vulyk agents`.
 */
export async function syncCommand(): Promise<void> {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);
  const projectRoot = path.dirname(manifestPath);

  cleanupStale(manifest, projectRoot);

  log.blue("\nSyncing entries:");
  let changed = false;

  for (const name of Object.keys(manifest.entries)) {
    const entry = getEntry(manifest, name);
    if (!entry) continue;
    const updatedSource = await syncEntry(name, projectRoot, manifest);
    if (updatedSource && updatedSource !== entry.source) {
      manifest.entries[name] = { ...entry, source: updatedSource };
      changed = true;
    }
  }

  if (changed) writeManifest(manifestPath, manifest);
  log.success("\nSync complete");
}
