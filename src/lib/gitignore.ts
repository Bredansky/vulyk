import * as fs from "node:fs";
import * as path from "node:path";

const MARKER_START = "# managed by vulyk";
const MARKER_END = "# end vulyk";

export function updateGitignore(dir: string, entries: string[]): void {
  const gitignorePath = path.join(dir, ".gitignore");
  const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf8") : "";

  // Strip existing vulyk block
  const withoutBlock = existing
    .replace(new RegExp(`${MARKER_START}[\\s\\S]*?${MARKER_END}\\n?`, "g"), "")
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

export function getGitignoreEntries(dir: string): string[] {
  const gitignorePath = path.join(dir, ".gitignore");
  if (!fs.existsSync(gitignorePath)) return [];
  const content = fs.readFileSync(gitignorePath, "utf8");
  const match = new RegExp(`${MARKER_START}([\\s\\S]*?)${MARKER_END}`).exec(content);
  if (!match) return [];
  return match[1].trim().split("\n").filter(Boolean);
}
