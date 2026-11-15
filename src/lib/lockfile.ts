import * as fs from "node:fs";
import * as path from "node:path";
import { writeTextFile } from "./text.js";

export const LOCKFILE = "vulyk.lock.json";

/** Internal lookup remains keyed by repository and ref. */
export interface VulykLockfile {
  github: Record<string, string>;
}

interface GitHubLockEntry {
  ref: string;
  commit: string;
}

const commitPattern = /^[0-9a-f]{40}$/i;

function validateCommit(
  commit: unknown,
  key: string,
): asserts commit is string {
  if (typeof commit !== "string" || !commitPattern.test(commit)) {
    throw new Error(`${LOCKFILE} has an invalid commit for ${key}.`);
  }
}

function recordPin(
  github: Record<string, string>,
  key: string,
  commit: unknown,
): void {
  validateCommit(commit, key);
  if (Object.hasOwn(github, key)) {
    throw new Error(`${LOCKFILE} contains a duplicate GitHub ref: ${key}.`);
  }
  github[key] = commit;
}

export function readLockfile(projectRoot: string): VulykLockfile {
  const filePath = path.join(projectRoot, LOCKFILE);
  if (!fs.existsSync(filePath)) return { github: {} };
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!isRecord(parsed) || !isRecord(parsed.github)) {
    throw new Error(`${LOCKFILE}.github must contain an object.`);
  }

  const github: Record<string, string> = {};
  for (const [repository, entries] of Object.entries(parsed.github)) {
    if (typeof entries === "string") {
      // Legacy format: "owner/repo@main": "<commit>".
      if (!isGitHubLockKey(repository)) {
        throw new Error(
          `${LOCKFILE} has an invalid GitHub ref: ${repository}.`,
        );
      }
      recordPin(github, repository, entries);
      continue;
    }
    if (!isRepository(repository) || !Array.isArray(entries)) {
      throw new Error(
        `${LOCKFILE} has invalid GitHub entries for ${repository}.`,
      );
    }
    for (const entry of entries) {
      if (!isRecord(entry) || typeof entry.ref !== "string" || !entry.ref) {
        throw new Error(
          `${LOCKFILE} has an invalid GitHub ref for ${repository}.`,
        );
      }
      recordPin(
        github,
        githubLockKeyFromRepository(repository, entry.ref),
        entry.commit,
      );
    }
  }
  return { github };
}

export function writeLockfile(
  projectRoot: string,
  lockfile: VulykLockfile,
): void {
  const filePath = path.join(projectRoot, LOCKFILE);
  const github: Record<string, GitHubLockEntry[]> = {};
  for (const key of Object.keys(lockfile.github).sort()) {
    if (!isGitHubLockKey(key)) {
      throw new Error(`${LOCKFILE} has an invalid GitHub ref: ${key}.`);
    }
    const separator = key.lastIndexOf("@");
    const repository = key.slice(0, separator);
    const ref = key.slice(separator + 1);
    const commit = lockfile.github[key];
    validateCommit(commit, key);
    (github[repository] ??= []).push({ ref, commit });
  }

  const tmp = `${filePath}.tmp`;
  writeTextFile(tmp, `${JSON.stringify({ github }, null, 2)}\n`);
  fs.renameSync(tmp, filePath);
}

export function githubLockKey(
  owner: string,
  repo: string,
  ref: string,
): string {
  return githubLockKeyFromRepository(`${owner}/${repo}`, ref);
}

function githubLockKeyFromRepository(repository: string, ref: string): string {
  return `${repository}@${ref}`;
}

function isGitHubLockKey(key: string): boolean {
  const separator = key.lastIndexOf("@");
  return (
    separator > 0 &&
    isRepository(key.slice(0, separator)) &&
    separator < key.length - 1
  );
}

function isRepository(repository: string): boolean {
  return /^[^/@]+\/[^/@]+$/.test(repository);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
