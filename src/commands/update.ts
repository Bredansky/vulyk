import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { execSync } from "node:child_process";
import { findManifest, readManifest, writeManifest } from "../lib/manifest.js";
import {
  parseSource,
  fetchSource,
  ensureGitRepoCache,
  type GitResolvedSource,
} from "../lib/fetcher.js";
import { install } from "../lib/installer.js";
import { color, log } from "../lib/log.js";
import { pinSpecifier, stripPinnedRef } from "../lib/specifier.js";
import {
  resolveOutputPaths,
  resolveGitignoreGenerated,
} from "../lib/groups.js";
import type { Manifest } from "../types.js";

function fetchLatest(repoUrl: string, ref: string): string {
  const repoCache = ensureGitRepoCache(repoUrl);
  return execSync(`git --git-dir="${repoCache}" rev-parse "${ref}"`, {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}

function isGitSource(
  value: ReturnType<typeof parseSource>,
): value is GitResolvedSource {
  return value.kind === "git";
}

function isLocalSource(projectRoot: string, source: string): boolean {
  return fs.existsSync(path.resolve(projectRoot, source));
}

async function updateEntry(
  name: string,
  entry: Manifest["entries"][string],
  projectRoot: string,
  manifest: Manifest,
): Promise<{ updatedSource?: string }> {
  if (isLocalSource(projectRoot, entry.source)) {
    const sourcePath = path.resolve(projectRoot, entry.source);
    const outPaths = resolveOutputPaths(manifest, name);
    install(name, sourcePath, outPaths, {
      gitignore: resolveGitignoreGenerated(manifest, name),
    });
    log.dim(`  ${name} refreshed from disk`);
    return {};
  }

  const outPaths = resolveOutputPaths(manifest, name);
  const gitignore = resolveGitignoreGenerated(manifest, name);
  const tmpDir = path.join(os.homedir(), ".vulyk", "tmp", name);
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  try {
    const resolved = parseSource(entry.source);
    let normalizedSource = entry.source;

    if (isGitSource(resolved)) {
      const baseSpecifier = stripPinnedRef(entry.source);
      const baseResolved = parseSource(baseSpecifier);
      if (!isGitSource(baseResolved)) {
        throw new Error("Expected git source");
      }
      const latestCommit = fetchLatest(baseResolved.repoUrl, baseResolved.ref);
      const currentCommit = /^[0-9a-f]{7,}$/.exec(resolved.ref)
        ? resolved.ref
        : null;
      if (currentCommit && latestCommit === currentCommit) {
        log.dim(`  ${name} already up to date (${latestCommit.slice(0, 7)})`);
        return {};
      }
      const prev = currentCommit?.slice(0, 7) ?? resolved.ref;
      log.print(
        `  ${color.blue(name)} ${color.dim(`${prev} -> ${latestCommit.slice(0, 7)}`)}`,
      );
      baseResolved.ref = latestCommit;
      await fetchSource(baseResolved, tmpDir);
      install(name, tmpDir, outPaths, { gitignore });
      fs.rmSync(tmpDir, { recursive: true, force: true });
      normalizedSource = pinSpecifier(baseSpecifier, latestCommit);
    } else {
      log.print(`  ${color.blue(name)} ${color.dim("refreshing direct URL")}`);
      await fetchSource(resolved, tmpDir);
      install(name, tmpDir, outPaths, { gitignore });
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    return { updatedSource: normalizedSource };
  } catch (err) {
    log.error(
      `Failed to update "${name}": ${err instanceof Error ? err.message : String(err)}`,
    );
    return {};
  }
}

export async function updateCommand(name?: string): Promise<void> {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);
  const projectRoot = path.dirname(manifestPath);

  const entries = name
    ? Object.entries(manifest.entries).filter(([n]) => n === name)
    : Object.entries(manifest.entries);

  if (entries.length === 0) {
    log.warn(name ? `"${name}" not found` : "Nothing to update");
    return;
  }

  let updated = 0;

  for (const [entryName, entry] of entries) {
    const { updatedSource } = await updateEntry(
      entryName,
      entry,
      projectRoot,
      manifest,
    );
    if (updatedSource && updatedSource !== entry.source) {
      manifest.entries[entryName] = { ...entry, source: updatedSource };
      updated++;
    }
  }

  if (updated > 0) writeManifest(manifestPath, manifest);
  log.print("");
  if (updated > 0) log.success(`Updated ${String(updated)} item(s)`);
}
