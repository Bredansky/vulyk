import { execSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import { findManifest, readManifest } from "../lib/manifest.js";
import {
  ensureGitRepoCache,
  parseSource,
  type GitResolvedSource,
} from "../lib/fetcher.js";
import { color, log } from "../lib/log.js";
import { stripPinnedRef } from "../lib/specifier.js";

function fetchLatest(repoUrl: string, ref: string): string {
  const repoCache = ensureGitRepoCache(repoUrl);
  return execSync(`git --git-dir="${repoCache}" rev-parse "${ref}"`, {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}

function showDiff(
  repoCache: string,
  from: string,
  to: string,
  subPath: string | null,
  isFile: boolean,
): void {
  try {
    if (isFile && subPath) {
      const diff = execSync(
        `git --git-dir="${repoCache}" diff ${from}..${to} -- "${subPath}"`,
        { encoding: "utf8", stdio: "pipe" },
      ).trim();
      if (diff) {
        const lines = diff.split("\n").slice(0, 20);
        log.print(color.dim(lines.map((line) => `    ${line}`).join("\n")));
        if (diff.split("\n").length > 20) {
          log.print(color.dim("    ... (truncated)"));
        }
      }
    } else {
      const pathFilter = subPath ? `-- "${subPath}"` : "";
      const stat = execSync(
        `git --git-dir="${repoCache}" diff --stat ${from}..${to} ${pathFilter}`,
        { encoding: "utf8", stdio: "pipe" },
      ).trim();
      if (stat) {
        log.print(
          color.dim(
            stat
              .split("\n")
              .map((line) => `    ${line}`)
              .join("\n"),
          ),
        );
      }
    }
  } catch {
    /* no diff */
  }
}

function isGitSource(
  value: ReturnType<typeof parseSource>,
): value is GitResolvedSource {
  return value.kind === "git";
}

function isLocalSource(projectRoot: string, source: string): boolean {
  return fs.existsSync(path.resolve(projectRoot, source));
}

export function diffCommand(name?: string): void {
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
    log.warn(name ? `"${name}" not found` : "Nothing to diff");
    return;
  }

  let hasUpdates = false;

  for (const [entryName, entry] of entries) {
    if (isLocalSource(projectRoot, entry.source)) {
      log.print(`  ${color.dim(`${entryName} is local; diff unavailable`)}`);
      continue;
    }

    const resolved = parseSource(entry.source);
    if (!isGitSource(resolved)) {
      log.print(
        `  ${color.blue(entryName)} ${color.dim("direct URL source; diff unavailable")}`,
      );
      continue;
    }

    const baseResolved = parseSource(stripPinnedRef(entry.source));
    if (!isGitSource(baseResolved)) continue;

    let latestCommit: string;
    try {
      latestCommit = fetchLatest(baseResolved.repoUrl, baseResolved.ref);
    } catch {
      log.error(`Could not resolve ref for "${entryName}"`);
      continue;
    }

    const repoCache = ensureGitRepoCache(baseResolved.repoUrl);
    const currentCommit = /^[0-9a-f]{7,}$/.exec(resolved.ref)
      ? resolved.ref
      : null;

    if (currentCommit && latestCommit === currentCommit) {
      log.print(
        `  ${color.dim(`${entryName} up to date (${latestCommit.slice(0, 7)})`)}`,
      );
      continue;
    }

    hasUpdates = true;
    const prev = currentCommit?.slice(0, 7) ?? resolved.ref;
    log.print(
      `  ${color.blue(entryName)} ${color.dim(`${prev} -> ${latestCommit.slice(0, 7)}`)}`,
    );
    if (currentCommit) {
      showDiff(
        repoCache,
        currentCommit,
        latestCommit,
        baseResolved.subPath,
        !entry.targets, // skill-style entries are directories (not file)
      );
    }
  }

  if (!hasUpdates) log.print(`\n  ${color.dim("All up to date")}`);
  log.print("");
}
