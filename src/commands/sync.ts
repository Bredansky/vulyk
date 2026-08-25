import * as path from "node:path";
import * as fs from "node:fs";
import { findManifest, readManifest } from "../lib/manifest.js";
import {
  parseSource,
  fetchSource,
  resolveFetchedInstallSource,
} from "../lib/fetcher.js";
import { install, uninstall } from "../lib/installer.js";
import {
  getEntry,
  isEnabled,
  resolveOutputPaths,
  resolveGitignoreGenerated,
} from "../lib/groups.js";
import { refreshGitignore } from "../lib/gitignore.js";
import { log } from "../lib/log.js";
import { cleanupStale } from "../lib/cleanup.js";
import { pinSpecifier } from "../lib/specifier.js";
import { readState, writeState } from "../lib/state.js";
import { githubLockKey, readLockfile, writeLockfile } from "../lib/lockfile.js";
import { getProjectTempPath } from "../lib/cache.js";
import { resolveMarkdownLinks } from "../lib/markdown-links.js";
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
  lockfile: ReturnType<typeof readLockfile>,
): Promise<string | null | undefined> {
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

  if (sourceIsLocal) {
    const sourcePath = path.resolve(projectRoot, entry.source);
    const result = install(name, sourcePath, outPaths, {
      gitignore,
      preservePaths: [sourcePath],
    });
    for (const p of result.managedPaths) {
      newSyncPaths.push(toRootRelative(projectRoot, p));
    }
  } else {
    const tmpDir = getProjectTempPath(name);
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    try {
      const resolved = parseSource(entry.source);
      let sourceToFetch = entry.source;
      if (resolved.kind === "git" && !/^[0-9a-f]{40}$/i.test(resolved.ref)) {
        const parts = new URL(entry.source).pathname.split("/").filter(Boolean);
        const owner = parts[0];
        const repo = parts[1];
        const locked =
          owner && repo
            ? lockfile.github[githubLockKey(owner, repo, resolved.ref)]
            : undefined;
        if (locked) sourceToFetch = pinSpecifier(entry.source, locked);
      }
      const commit = await fetchSource(parseSource(sourceToFetch), tmpDir);
      const installSrc = resolveFetchedInstallSource(entry.source, tmpDir);
      const result = install(name, installSrc, outPaths, {
        gitignore,
      });
      for (const p of result.managedPaths) {
        newSyncPaths.push(toRootRelative(projectRoot, p));
      }
      if (
        manifest.linkResolution &&
        resolved.kind === "git" &&
        resolved.subPath?.toLowerCase().endsWith(".md")
      ) {
        const installedPath = result.managedPaths[0];
        if (installedPath?.toLowerCase().endsWith(".md")) {
          const installedBody = fs.readFileSync(installedPath, "utf8");
          const resolvedMarkdown = resolveMarkdownLinks(
            installedBody,
            sourceToFetch,
            installedPath,
            projectRoot,
            manifest.linkResolution,
            lockfile,
            0,
          );
          fs.writeFileSync(installedPath, resolvedMarkdown.markdown);
          for (const linkedPath of resolvedMarkdown.managedPaths) {
            newSyncPaths.push(toRootRelative(projectRoot, linkedPath));
          }
        }
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
      if (commit) {
        const sourceUrl = new URL(entry.source);
        const parts = sourceUrl.pathname.split("/").filter(Boolean);
        const owner = parts[0];
        const repo = parts[1];
        const ref = parts[3];
        if (owner && repo && ref && !/^[0-9a-f]{40}$/i.test(ref)) {
          lockfile.github[githubLockKey(owner, repo, ref)] = commit;
        }
      }
    } catch (err) {
      log.error(
        `Failed to sync "${name}": ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  log.success(name);
  return undefined;
}

/**
 * Sync every enabled entry: install from source, populate
 * local generated state, prune stale managed files, refresh the gitignore
 * block.
 */
export async function syncCommand(): Promise<boolean> {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.config.ts found.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);
  const projectRoot = path.dirname(manifestPath);
  const lockfile = readLockfile(projectRoot);

  // Read local generated-file ownership state.
  const previousState = readState(projectRoot);

  log.blue("\nSyncing entries:");
  let failed = false;
  const newSyncPaths: string[] = [];

  for (const name of Object.keys(manifest.entries)) {
    const entry = getEntry(manifest, name);
    if (!entry) continue;
    const syncResult = await syncEntry(
      name,
      projectRoot,
      manifest,
      newSyncPaths,
      lockfile,
    );
    if (syncResult === null) {
      failed = true;
      continue;
    }
  }

  if (failed) {
    log.error(
      "\nSync failed; managed-file cleanup and state updates were skipped.",
    );
    return false;
  }

  // Set-difference: paths in `previousState.syncPaths` that aren't
  // produced by this sync are deleted (file-, dir-, or empty-parent
  // cleanup happens inside applyCleanupDelta).
  cleanupStale(projectRoot, previousState.syncPaths, newSyncPaths);

  // Persist the resolved GitHub refs separately from executable config.

  writeLockfile(projectRoot, lockfile);

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
  return true;
}
