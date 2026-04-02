import * as fs from "node:fs";
import * as path from "node:path";

const MARKER_START = "# managed by vulyk";
const MARKER_END = "# end vulyk";

function findRoot(): string {
  // Walk up to find root .gitignore or package.json
  let dir = process.cwd();
  while (true) {
    if (fs.existsSync(path.join(dir, ".git")) || fs.existsSync(path.join(dir, "package.json"))) {
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
  const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf8") : "";

  const withoutBlock = existing
    .replace(new RegExp(`\\n?${MARKER_START}[\\s\\S]*?${MARKER_END}\\n?`, "g"), "")
    .trimEnd();

  if (entries.length === 0) {
    const result = withoutBlock.length > 0 ? `${withoutBlock}\n` : "";
    if (result !== existing) fs.writeFileSync(gitignorePath, result);
    return;
  }

  const block = `${MARKER_START}\n${entries.join("\n")}\n${MARKER_END}`;
  const result = withoutBlock.length > 0 ? `${withoutBlock}\n\n${block}\n` : `${block}\n`;
  fs.writeFileSync(gitignorePath, result);
}

export function getRootGitignoreEntries(): string[] {
  const root = findRoot();
  const gitignorePath = path.join(root, ".gitignore");
  if (!fs.existsSync(gitignorePath)) return [];
  const content = fs.readFileSync(gitignorePath, "utf8");
  const match = new RegExp(`${MARKER_START}([\\s\\S]*?)${MARKER_END}`).exec(content);
  if (!match) return [];
  return match[1].trim().split("\n").filter(Boolean);
}
