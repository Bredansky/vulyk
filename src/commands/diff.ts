import * as fs from "node:fs";
import { execSync } from "node:child_process";
import * as path from "node:path";
import { findManifest, readManifest } from "../lib/manifest.js";
import { parseSource, type GitResolvedSource } from "../lib/fetcher.js";
import { color, log } from "../lib/log.js";
import { getRepoCachePath } from "../lib/cache.js";
import { stripPinnedRef } from "../lib/specifier.js";
import { isRemoteDocSource, validateDocsManifest } from "../lib/docs.js";
import { validateSkillsManifest } from "../lib/skills.js";

function fetchLatest(repoCache: string, ref: string): string {
  try {
    if (fs.existsSync(repoCache)) {
      execSync(`git --git-dir="${repoCache}" fetch --all --tags`, {
        stdio: "pipe",
      });
    }
  } catch {
    /* use cached */
  }
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
    const pathFilter = subPath ? `-- "${subPath}"` : "";
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

export function diffCommand(name?: string): void {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);
  const projectRoot = path.dirname(manifestPath);
  validateSkillsManifest(manifest);
  validateDocsManifest(manifest, projectRoot);

  const skills = name
    ? Object.entries(manifest.skills.entries).filter(
        ([entryName]) => entryName === name,
      )
    : Object.entries(manifest.skills.entries);
  const docs = name
    ? Object.entries(manifest.docs.entries).filter(
        ([entryName]) => entryName === name,
      )
    : Object.entries(manifest.docs.entries);

  if (skills.length === 0 && docs.length === 0) {
    log.warn(name ? `"${name}" not found` : "Nothing to diff");
    return;
  }

  let hasUpdates = false;

  if (skills.length > 0) {
    log.print(color.dim("\nSkills:"));
    for (const [entryName, entry] of skills) {
      const resolved = parseSource(entry.source);
      if (!isGitSource(resolved)) {
        log.print(
          `  ${color.blue(entryName)} ${color.dim("direct URL source; diff unavailable")}`,
        );
        continue;
      }

      const repoCache = getRepoCachePath(resolved.repoUrl);
      const baseResolved = parseSource(stripPinnedRef(entry.source));
      if (!isGitSource(baseResolved)) {
        continue;
      }

      let latestCommit: string;
      try {
        latestCommit = fetchLatest(repoCache, baseResolved.ref);
      } catch {
        log.error(`Could not resolve ref for "${entryName}"`);
        continue;
      }

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
          false,
        );
      }
    }
  }

  if (docs.length > 0) {
    log.print(color.dim("\nDocs:"));
    for (const [entryName, entry] of docs) {
      if (!isRemoteDocSource(projectRoot, entry.source)) {
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

      const repoCache = getRepoCachePath(resolved.repoUrl);
      const baseResolved = parseSource(stripPinnedRef(entry.source));
      if (!isGitSource(baseResolved)) {
        continue;
      }

      let latestCommit: string;
      try {
        latestCommit = fetchLatest(repoCache, baseResolved.ref);
      } catch {
        log.error(`Could not resolve ref for "${entryName}"`);
        continue;
      }

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
          true,
        );
      }
    }
  }

  if (!hasUpdates) log.print(`\n  ${color.dim("All up to date")}`);
  log.print("");
}
