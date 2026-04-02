import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { execSync } from "node:child_process";
import { findManifest, readManifest } from "../lib/manifest.js";
import { parseSource } from "../lib/fetcher.js";
import { color, log } from "../lib/log.js";

function getRepoCache(repoUrl: string): string {
  return path.join(
    os.homedir(),
    ".vulyk",
    "cache",
    Buffer.from(repoUrl).toString("base64url").slice(0, 32),
  );
}

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
        log.print(color.dim(lines.map((l) => `    ${l}`).join("\n")));
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
              .map((l) => `    ${l}`)
              .join("\n"),
          ),
        );
      }
    }
  } catch {
    /* no diff */
  }
}

export function diffCommand(name?: string): void {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);

  const skills = name
    ? Object.entries(manifest.skills).filter(([n]) => n === name)
    : Object.entries(manifest.skills);
  const docs = name
    ? Object.entries(manifest.docs).filter(([n]) => n === name)
    : Object.entries(manifest.docs);

  if (skills.length === 0 && docs.length === 0) {
    log.warn(name ? `"${name}" not found` : "Nothing to diff");
    return;
  }

  let hasUpdates = false;

  for (const [n, specifier] of skills) {
    const resolved = parseSource(specifier);
    const repoCache = getRepoCache(resolved.repoUrl);
    const baseResolved = parseSource(specifier.replace(/@[0-9a-f]{7,}$/, ""));

    let latestCommit: string;
    try {
      latestCommit = fetchLatest(repoCache, baseResolved.ref);
    } catch {
      log.error(`Could not resolve ref for "${n}"`);
      continue;
    }

    const currentCommit = /^[0-9a-f]{7,}$/.exec(resolved.ref)
      ? resolved.ref
      : null;
    if (currentCommit && latestCommit === currentCommit) {
      log.print(
        `  ${color.dim(`${n} up to date (${latestCommit.slice(0, 7)})`)}`,
      );
      continue;
    }

    hasUpdates = true;
    const prev = currentCommit?.slice(0, 7) ?? resolved.ref;
    log.print(
      `\n  ${color.blue(n)} ${color.dim(`${prev} → ${latestCommit.slice(0, 7)}`)}`,
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

  for (const [n, entry] of docs) {
    const resolved = parseSource(entry.source);
    const repoCache = getRepoCache(resolved.repoUrl);
    const baseResolved = parseSource(
      entry.source.replace(/@[0-9a-f]{7,}$/, ""),
    );

    let latestCommit: string;
    try {
      latestCommit = fetchLatest(repoCache, baseResolved.ref);
    } catch {
      log.error(`Could not resolve ref for doc "${n}"`);
      continue;
    }

    const currentCommit = /^[0-9a-f]{7,}$/.exec(resolved.ref)
      ? resolved.ref
      : null;
    if (currentCommit && latestCommit === currentCommit) {
      log.print(
        `  ${color.dim(`doc:${n} up to date (${latestCommit.slice(0, 7)})`)}`,
      );
      continue;
    }

    hasUpdates = true;
    const prev = currentCommit?.slice(0, 7) ?? resolved.ref;
    log.print(
      `\n  ${color.blue(`doc:${n}`)} ${color.dim(`${prev} → ${latestCommit.slice(0, 7)}`)}`,
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

  if (!hasUpdates) log.print(`\n  ${color.dim("All up to date")}`);
  log.print("");
}
