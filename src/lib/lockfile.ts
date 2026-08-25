import * as fs from "node:fs";
import * as path from "node:path";
import { writeTextFile } from "./text.js";

export const LOCKFILE = "vulyk.lock.json";

export interface VulykLockfile {
  github: Record<string, string>;
}

export function readLockfile(projectRoot: string): VulykLockfile {
  const filePath = path.join(projectRoot, LOCKFILE);
  if (!fs.existsSync(filePath)) return { github: {} };
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!isRecord(parsed) || !isRecord(parsed.github)) {
    throw new Error(`${LOCKFILE}.github must contain an object.`);
  }
  const github: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed.github)) {
    if (typeof value !== "string" || !/^[0-9a-f]{40}$/i.test(value)) {
      throw new Error(`${LOCKFILE} has an invalid commit for ${key}.`);
    }
    github[key] = value;
  }
  return { github };
}

export function writeLockfile(
  projectRoot: string,
  lockfile: VulykLockfile,
): void {
  const filePath = path.join(projectRoot, LOCKFILE);
  const tmp = `${filePath}.tmp`;
  writeTextFile(tmp, `${JSON.stringify(lockfile, null, 2)}\n`);
  fs.renameSync(tmp, filePath);
}

export function githubLockKey(
  owner: string,
  repo: string,
  ref: string,
): string {
  return `${owner}/${repo}@${ref}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
