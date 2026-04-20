import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { updateRootGitignore, getRootGitignoreEntries } from "./gitignore.js";

export function resolvePath(p: string): string {
  return p.startsWith("~")
    ? path.join(os.homedir(), p.slice(1))
    : path.resolve(p);
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}

function readSkillName(srcDir: string): string | null {
  const skillFile = path.join(srcDir, "SKILL.md");
  if (!fs.existsSync(skillFile)) return null;
  const content = fs.readFileSync(skillFile, "utf8");
  const match = /^---\r?\n(?<fm>[\s\S]*?)\r?\n---/.exec(content);
  if (!match) return null;
  const nameLine = (match.groups?.fm ?? "")
    .split("\n")
    .find((l) => l.trimStart().startsWith("name:"));
  return nameLine
    ? (nameLine.split(":")[1] ?? "").trim().replace(/^["']|["']$/g, "")
    : null;
}

const MARKER = ".vulyk";
const MARKER_CONTENT = "🍯\n";

interface InstallOptions {
  preservePaths?: string[];
}

function normalizeAbsolutePath(value: string): string {
  return path.resolve(value);
}

function isPreservedPath(
  candidate: string,
  preservePaths: string[] | undefined,
): boolean {
  if (!preservePaths || preservePaths.length === 0) return false;
  const normalizedCandidate = normalizeAbsolutePath(candidate);
  return preservePaths.some(
    (preservePath) =>
      normalizeAbsolutePath(preservePath) === normalizedCandidate,
  );
}

export function resolveInstallName(
  packageName: string,
  srcDir: string,
): string {
  return readSkillName(srcDir) ?? packageName;
}

export function install(
  packageName: string,
  srcDir: string,
  targetPaths: string[],
  opts?: InstallOptions,
): string {
  const installName = resolveInstallName(packageName, srcDir);
  for (const targetPath of targetPaths) {
    const resolved = resolvePath(targetPath);
    const dest = path.join(resolved, installName);
    if (isPreservedPath(dest, opts?.preservePaths)) {
      continue;
    }
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
    copyDir(srcDir, dest);
    fs.writeFileSync(path.join(dest, MARKER), MARKER_CONTENT);
  }
  // Add to root .gitignore — use relative path from first target
  const entries = new Set(getRootGitignoreEntries());
  for (const targetPath of targetPaths) {
    const resolved = resolvePath(targetPath);
    const dest = path.join(resolved, installName);
    if (isPreservedPath(dest, opts?.preservePaths)) {
      continue;
    }
    entries.add(`${targetPath}/${installName}/`);
  }
  updateRootGitignore([...entries].sort());
  return installName;
}

export function uninstall(
  name: string,
  targetPaths: string[],
  opts?: InstallOptions,
): void {
  for (const targetPath of targetPaths) {
    const resolved = resolvePath(targetPath);
    const dest = path.join(resolved, name);
    if (isPreservedPath(dest, opts?.preservePaths)) {
      continue;
    }
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  }
  // Remove from root .gitignore
  const toRemove = new Set(
    targetPaths
      .filter((targetPath) => {
        const resolved = resolvePath(targetPath);
        const dest = path.join(resolved, name);
        return !isPreservedPath(dest, opts?.preservePaths);
      })
      .map((targetPath) => `${targetPath}/${name}/`),
  );
  const entries = getRootGitignoreEntries().filter((e) => !toRemove.has(e));
  updateRootGitignore(entries);
}

export function isManagedByVulyk(skillDir: string): boolean {
  return fs.existsSync(path.join(skillDir, MARKER));
}
