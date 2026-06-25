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
import { refreshGitignore } from "../lib/gitignore.js";
import { log } from "../lib/log.js";
import { pinSpecifier } from "../lib/specifier.js";
import { cleanupStale } from "../lib/cleanup.js";
import { readState, writeState } from "../lib/state.js";
import type { Manifest } from "../types.js";

function isLocalSource(projectRoot: string, source: string): boolean {
  return fs.existsSync(path.resolve(projectRoot, source));
}

function toRootRelative(projectRoot: string, absPath: string): string {
  const rel = path.relative(projectRoot, absPath);
  return rel.split(path.sep).join("/");
}

/**
 * Sync one entry from its source to the configured output paths. Returns
 * the absolute paths that were actually written (the install's
 * `managedPaths`). Note: `vulyk sync` does NOT generate AGENTS.md/CLAUDE.md
 * — that's the `vulyk agents` command's responsibility.
 */
async function syncEntry(
  name: string,
  projectRoot: string,
  manifest: Manifest,
  newSyncPaths: string[],
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
  const gitignore = explicitGitignore;
  const sourceIsLocal = isLocalSource(projectRoot, entry.source);

  let updatedSource: string | undefined;

  if (sourceIsLocal) {
    const sourcePath = path.resolve(projectRoot, entry.source);
    const result = install(name, sourcePath, outPaths, {
      gitignore,
      preservePaths: [sourcePath],
      preserveFolderForSingleFile: true,
    });
    for (const p of result.managedPaths) {
      newSyncPaths.push(toRootRelative(projectRoot, p));
    }
  } else {
    const tmpDir = path.join(os.homedir(), ".vulyk", "tmp", name);
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    try {
      const commit = await fetchSource(parseSource(entry.source), tmpDir);
      const result = install(name, tmpDir, outPaths, {
        gitignore,
        preserveFolderForSingleFile: true,
      });
      for (const p of result.managedPaths) {
        newSyncPaths.push(toRootRelative(projectRoot, p));
      }
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
 * Sync every enabled entry: install from source, populate
 * `.vulyk`, prune stale managed files, refresh the gitignore
 * block.
 */
export async function syncCommand(): Promise<void> {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);
  const projectRoot = path.dirname(manifestPath);

  // Read the previous state. `readState` transparently migrates any
  // legacy per-directory `.vulyk` markers on first run.
  const previousState = readState(projectRoot);

  log.blue("\nSyncing entries:");
  let changed = false;
  const newSyncPaths: string[] = [];

  for (const name of Object.keys(manifest.entries)) {
    const entry = getEntry(manifest, name);
    if (!entry) continue;
    const updatedSource = await syncEntry(
      name,
      projectRoot,
      manifest,
      newSyncPaths,
    );
    if (updatedSource && updatedSource !== entry.source) {
      manifest.entries[name] = { ...entry, source: updatedSource };
      changed = true;
    }
  }

  // Set-difference: paths in `previousState.syncPaths` that aren't
  // produced by this sync are deleted (file-, dir-, or empty-parent
  // cleanup happens inside applyCleanupDelta).
  cleanupStale(projectRoot, previousState.syncPaths, newSyncPaths);

  // Persist manifest first (the source of INTENT) when entries were
  // re-pinned, then write the lockfile (cleanup truth). If writeState
  // were to fail AFTER writeManifest succeeded, the next `vulyk sync`
  // would see the manifest's entries, re-install them (idempotent), and
  // re-record the paths; the inverted order would silently prune the
  // just-installed entries on the next sync. Matches the order in add.ts.

  if (changed) writeManifest(manifestPath, manifest);

  // We deliberately preserve agentPaths so a subsequent `vulyk agents`
  // can reconcile against what it produces.
  writeState(projectRoot, {
    syncPaths: newSyncPaths,
    agentPaths: previousState.agentPaths,
  });

  // Refresh the gitignore block to match the current state of the file
  // system (no `**/.vulyk` is inserted any more — see gitignore.ts).
  refreshGitignore(manifest, projectRoot);

  log.success("\nSync complete");
}
