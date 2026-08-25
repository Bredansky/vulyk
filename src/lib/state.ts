import * as fs from "node:fs";
import * as path from "node:path";
import { writeTextFile } from "./text.js";

const VULYK_STATE_FILE = path.join(".vulyk", "state.json");

export interface VulykState {
  syncPaths: string[];
  agentPaths: string[];
}

function emptyState(): VulykState {
  return { syncPaths: [], agentPaths: [] };
}

function parseLine(
  line: string,
): { kind: "agent" | "doc"; path: string } | null {
  if (line.startsWith("\u{1F36F} ")) {
    return { kind: "agent", path: line.slice("\u{1F36F} ".length) };
  }
  if (line.startsWith("\u{1F41D} ")) {
    return { kind: "doc", path: line.slice("\u{1F41D} ".length) };
  }
  return null;
}

export function readState(dir: string): VulykState {
  const f = path.join(dir, VULYK_STATE_FILE);
  if (!fs.existsSync(f)) return emptyState();
  const text = fs.readFileSync(f, "utf8");
  const agentPaths: string[] = [];
  const syncPaths: string[] = [];
  for (const line of text.split("\n")) {
    const entry = parseLine(line);
    if (!entry) continue;
    if (entry.kind === "agent") agentPaths.push(entry.path);
    else syncPaths.push(entry.path);
  }
  return { agentPaths, syncPaths };
}

export function writeState(dir: string, state: VulykState): void {
  const f = path.join(dir, VULYK_STATE_FILE);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.tmp`;
  const agentLines = [...new Set(state.agentPaths)]
    .sort()
    .map((p) => `\u{1F36F} ${p}`);
  const syncLines = [...new Set(state.syncPaths)]
    .sort()
    .map((p) => `\u{1F41D} ${p}`);
  const out = [...agentLines, ...syncLines];
  writeTextFile(tmp, out.join("\n") + (out.length ? "\n" : ""));
  fs.renameSync(tmp, f);
}

export function applyCleanupDelta(
  dir: string,
  prev: string[],
  curr: string[],
): void {
  const projectRoot = path.resolve(dir);
  const stale = new Set(prev.filter((p) => !curr.includes(p)));
  for (const rel of stale) {
    // Refuse any path that resolves outside the project root.
    const target = path.resolve(dir, rel);
    if (target !== projectRoot && !target.startsWith(projectRoot + path.sep)) {
      continue;
    }
    fs.rmSync(target, { force: true, recursive: true });
    pruneEmptyParents(path.dirname(target), projectRoot);
  }
}

function pruneEmptyParents(abs: string, stopAt: string): void {
  let cur = abs;
  while (cur !== stopAt && cur !== path.dirname(cur)) {
    try {
      const entries = fs.readdirSync(cur);
      if (entries.length > 0) return;
      fs.rmdirSync(cur);
    } catch {
      return;
    }
    cur = path.dirname(cur);
  }
}
