// Regression test for the bug where vulyk agents pushed the same
// (entry × target × secondary agent) path multiple times into the
// lockfile's agentPaths array, producing 10 CLAUDE.md entries
// instead of 1 when 10 entries share `targets: ["."]`.
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { agentsCommand } from "../src/commands/agents.js";
import {
  readState,
  writeState,
  parseLockObject,
  type LockState,
  LOCK_FILENAME,
} from "../src/lib/state.js";

function makeTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-agents-dedup-"));
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeFile(filePath: string, body: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body, "utf8");
}

function readLockfile(projectRoot: string): LockState {
  const raw: unknown = JSON.parse(
    fs.readFileSync(path.join(projectRoot, LOCK_FILENAME), "utf8"),
  );
  const parsed = parseLockObject(raw);
  if (!parsed) {
    throw new Error(
      `readLockfile: ${LOCK_FILENAME} at project root did not parse as LockState`,
    );
  }
  return parsed;
}

const createdDirs: string[] = [];

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test("agentsCommand dedups agentPaths when many entries share the same target", () => {
  // 10 entries all inherit from group `external` which declares
  // agents: ["AGENTS.md", "CLAUDE.md"]; every entry has targets: ["."].
  // Without dedup, writeState would persist CLAUDE.md 10 times in
  // agentPaths and AGENTS.md 1 time — total 11. With the boundary dedup
  // (and writeState's defensive Set dedup), the lockfile lands with
  // exactly ["AGENTS.md", "CLAUDE.md"].
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  const groups = {
    external: {
      outputPaths: ["docs/external"],
      validate: { fileExtension: ".md" },
      agents: ["AGENTS.md", "CLAUDE.md"],
    },
  };
  const entries: Record<string, unknown> = {};
  for (let i = 0; i < 10; i++) {
    const name = `entry${String(i).padStart(2, "0")}`;
    entries[name] = {
      source: `docs/external/${name}.md`,
      group: "external",
      targets: ["."],
      description: `Description for ${name}.`,
    };
  }
  writeJson(path.join(projectRoot, "vulyk.json"), { groups, entries });

  // Write the doc file for each entry so computePrimaryContribution
  // finds the source and produces a contribution.
  for (let i = 0; i < 10; i++) {
    const name = `entry${String(i).padStart(2, "0")}`;
    writeFile(
      path.join(projectRoot, "docs", "external", `${name}.md`),
      `Title: ${name}\n# ${name}\n`,
    );
  }

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    agentsCommand();

    const lock = readLockfile(projectRoot);
    assert.ok(Array.isArray(lock.agentPaths), "lockfile has agentPaths");
    // Pin sorted shape explicitly: catches both a dedup regression
    // (length > 2) AND a future writeState ordering regression
    // (entries present but in the wrong order).
    assert.deepEqual(
      lock.agentPaths,
      ["AGENTS.md", "CLAUDE.md"],
      `agentPaths sorted ascending; got ${JSON.stringify(lock.agentPaths)}`,
    );

    // The primary AGENTS.md should actually be on disk at project root.
    assert.equal(
      fs.existsSync(path.join(projectRoot, "AGENTS.md")),
      true,
      "AGENTS.md was written at the target dir",
    );
    // The secondary CLAUDE.md should chain to its primary.
    const claudeMd = fs.readFileSync(
      path.join(projectRoot, "CLAUDE.md"),
      "utf8",
    );
    assert.ok(claudeMd.includes("@AGENTS.md"), "CLAUDE.md chains to primary");
  } finally {
    process.chdir(initialCwd);
  }
});

void test("writeState defensively dedups syncPaths/agentPaths even when callers pass duplicates", () => {
  // State.ts is a thin import \u2014 assert directly that writeState elides
  // duplicates from the input arrays before serialising to disk. Combined
  // with the boundary dedup in agentsCommand, this gives belt-and-braces
  // protection from the same-shape regression in any caller.
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);
  writeState(projectRoot, {
    version: 1,
    syncPaths: ["x", "x", "y", "z", "y"],
    agentPaths: ["AGENTS.md", "AGENTS.md", "CLAUDE.md"],
  });
  const r = readState(projectRoot);
  assert.deepEqual(r.syncPaths, ["x", "y", "z"]);
  assert.deepEqual(r.agentPaths, ["AGENTS.md", "CLAUDE.md"]);
});
