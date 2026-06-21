import * as fs from "node:fs";
import * as path from "node:path";
import type { Manifest } from "../types.js";
import {
  isEnabled,
  resolveOutputPaths,
  resolveAgents,
  resolveGitignoreGenerated,
} from "./groups.js";

const MARKER_START = "# managed by vulyk";
const MARKER_END = "# end vulyk";

function findRoot(): string {
  // Walk up to find root .gitignore or package.json
  let dir = process.cwd();
  for (;;) {
    if (
      fs.existsSync(path.join(dir, ".git")) ||
      fs.existsSync(path.join(dir, "package.json"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

export function updateRootGitignore(entries: string[]): void {
  const root = findRoot();
  const gitignorePath = path.join(root, ".gitignore");
  const existing = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, "utf8")
    : "";

  const withoutBlock = existing
    .replace(
      new RegExp(`\\n?${MARKER_START}[\\s\\S]*?${MARKER_END}\\n?`, "g"),
      "",
    )
    .trimEnd();

  if (entries.length === 0) {
    const result = withoutBlock.length > 0 ? `${withoutBlock}\n` : "";
    if (result !== existing) fs.writeFileSync(gitignorePath, result);
    return;
  }

  const block = `${MARKER_START}\n${entries.join("\n")}\n${MARKER_END}`;
  const result =
    withoutBlock.length > 0 ? `${withoutBlock}\n\n${block}\n` : `${block}\n`;
  fs.writeFileSync(gitignorePath, result);
}

export function getRootGitignoreEntries(): string[] {
  const root = findRoot();
  const gitignorePath = path.join(root, ".gitignore");
  if (!fs.existsSync(gitignorePath)) return [];
  const content = fs.readFileSync(gitignorePath, "utf8");
  const match = new RegExp(`${MARKER_START}([\\s\\S]*?)${MARKER_END}`).exec(
    content,
  );
  if (!match) return [];
  return (match[1] ?? "").trim().split("\n").filter(Boolean);
}

/**
 * Add an entry to the vulyk-managed gitignore block. Used by callers
 * that want to track paths outside the install pipeline (e.g. generated
 * AGENTS.md files).
 */
export function addToGitignore(relativeEntry: string): void {
  const entries = new Set(getRootGitignoreEntries());
  entries.add(relativeEntry);
  updateRootGitignore([...entries].sort());
}

/**
 * Compute the expected gitignore entries for a manifest, based on the
 * current state of the file system. Stale entries (left over from a
 * previous layout, e.g. a folder install that's now a flat file) are
 * excluded. Agent files (AGENTS.md, CLAUDE.md) generated for enabled
 * entries with `gitIgnore: true` are also included.
 *
 * Local sources that share their path with the install destination are
 * never gitignored — those are user-owned files, not vulyk-generated.
 */
export function computeExpectedGitignoreEntries(
  manifest: Manifest,
  projectRoot: string,
): string[] {
  const entries = new Set<string>();

  for (const [name, entry] of Object.entries(manifest.entries)) {
    if (!isEnabled(manifest, name)) continue;
    const gitignore = resolveGitignoreGenerated(manifest, name);
    if (gitignore !== true) continue;

    const outPaths = resolveOutputPaths(manifest, name);
    if (outPaths.length === 0) continue;

    // If this is a local source, compute its absolute path once. Used
    // to detect srcSameAsDest and skip gitignoring user-owned files.
    const sourceIsLocal = fs.existsSync(
      path.resolve(projectRoot, entry.source),
    );
    const localSourcePath = sourceIsLocal
      ? path.resolve(projectRoot, entry.source)
      : null;

    for (const outPath of outPaths) {
      const resolved = path.resolve(projectRoot, outPath);

      // Check if installed as a folder.
      const folderPath = path.join(resolved, name);
      if (
        fs.existsSync(folderPath) &&
        fs.statSync(folderPath).isDirectory() &&
        localSourcePath !== path.resolve(folderPath)
      ) {
        entries.add(`${outPath}/${name}/`);
        continue;
      }

      // Otherwise look for a flat file matching `<name>.*`.
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        const files = fs.readdirSync(resolved);
        for (const file of files) {
          if (file === ".vulyk") continue;
          const ext = path.extname(file);
          const base = path.basename(file, ext);
          if (base === name) {
            const fullPath = path.resolve(path.join(resolved, file));
            // Don't gitignore the local source itself.
            if (localSourcePath !== fullPath) {
              entries.add(`${outPath}/${file}`);
            }
          }
        }
      }
    }

    // Agent files (AGENTS.md, CLAUDE.md) generated for this entry.
    const agents = resolveAgents(manifest, name);
    if (entry.targets && entry.targets.length > 0) {
      for (const target of entry.targets) {
        for (const agent of agents) {
          entries.add(path.posix.join(target, agent));
        }
      }
    }
  }

  return [...entries].sort();
}

/**
 * Replace the vulyk-managed gitignore block with the current expected
 * entries. Removes stale paths (e.g. a previous folder install that's
 * now a flat file) that the per-install gitignore update would have left
 * behind.
 */
export function refreshGitignore(
  manifest: Manifest,
  projectRoot: string,
): void {
  const entries = computeExpectedGitignoreEntries(manifest, projectRoot);
  // Always gitignore the `.vulyk` manifest files themselves — they
  // describe vulyk's install state, not user content.
  entries.unshift("**/.vulyk");
  updateRootGitignore(entries);
}
