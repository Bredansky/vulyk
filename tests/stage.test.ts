import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { stageCommand } from "../src/commands/stage.js";
import { syncCommand } from "../src/commands/sync.js";
import { agentsCommand } from "../src/commands/agents.js";
import { readState, writeState } from "../src/lib/state.js";

const roots: string[] = [];
const originalCwd = process.cwd();

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-stage-"));
  roots.push(root);
  fs.writeFileSync(path.join(root, "vulyk.config.ts"), "export default {};\n");
  git(root, "init", "-q");
  return root;
}

function write(root: string, relativePath: string, value = "content"): void {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, value);
}

function commit(root: string): void {
  git(root, "add", "-A");
  git(
    root,
    "-c",
    "user.name=Vulyk Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-qm",
    "baseline",
  );
}

afterEach(() => {
  process.chdir(originalCwd);
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

void test("stage only managed generated paths, including created, updated and deleted files", () => {
  const root = fixture();
  write(root, "docs/generated.md", "old");
  write(root, "docs/stale.md", "stale");
  write(root, "src/unrelated.ts", "old");
  commit(root);

  write(root, "docs/generated.md", "updated");
  write(root, "docs/new.md", "new");
  write(root, "src/unrelated.ts", "unrelated edit");
  fs.rmSync(path.join(root, "docs/stale.md"));
  writeState(root, {
    syncPaths: ["docs/generated.md", "docs/new.md"],
    agentPaths: [],
    pendingStagePaths: ["docs/stale.md"],
  });

  process.chdir(root);
  stageCommand();

  assert.deepEqual(
    git(root, "diff", "--cached", "--name-only").split(/\r?\n/),
    ["docs/generated.md", "docs/new.md", "docs/stale.md"],
  );
  assert.equal(git(root, "diff", "--name-only"), "src/unrelated.ts");
  assert.equal(readState(root).pendingStagePaths, undefined);
});

void test("stage respects ignored untracked generated outputs", () => {
  const root = fixture();
  write(root, ".gitignore", "ignored/\n");
  write(root, "README.md", "baseline");
  commit(root);
  write(root, "ignored/AGENTS.md", "do not stage");
  write(root, "docs/AGENTS.md", "do stage");
  writeState(root, {
    agentPaths: ["ignored/AGENTS.md", "docs/AGENTS.md"],
    syncPaths: [],
  });

  process.chdir(root);
  stageCommand();
  assert.equal(git(root, "diff", "--cached", "--name-only"), "docs/AGENTS.md");
});

// Windows sandbox file locks can prevent removing the temporary config loaded by tsx.
void test(
  "sync and agents preserve stale managed paths until staging",
  { skip: process.platform === "win32" },
  async () => {
    const root = fixture();
    write(root, "vulyk.config.ts", "export default { entries: {} };");
    write(root, "managed/old.md", "old");
    write(root, "docs/AGENTS.md", "old");
    writeState(root, {
      syncPaths: ["managed/old.md"],
      agentPaths: ["docs/AGENTS.md"],
    });
    commit(root);

    process.chdir(root);
    assert.equal(await syncCommand(), true);
    agentsCommand();
    assert.deepEqual(readState(root).pendingStagePaths, [
      "docs/AGENTS.md",
      "managed/old.md",
    ]);
    stageCommand();
    assert.deepEqual(
      git(root, "diff", "--cached", "--name-only").split(/\r?\n/),
      ["docs/AGENTS.md", "managed/old.md"],
    );
    assert.equal(readState(root).pendingStagePaths, undefined);
  },
);

void test("stage with empty ownership does not stage unrelated work", () => {
  const root = fixture();
  write(root, "README.md", "before");
  commit(root);
  write(root, "README.md", "after");
  process.chdir(root);
  stageCommand();
  assert.equal(git(root, "diff", "--cached", "--name-only"), "");
  assert.equal(git(root, "diff", "--name-only"), "README.md");
});

void test("stage refuses unsafe paths before changing the index", () => {
  const root = fixture();
  write(root, "README.md", "before");
  commit(root);
  write(root, "README.md", "after");
  writeState(root, { syncPaths: ["../../README.md"], agentPaths: [] });
  process.chdir(root);
  assert.throws(() => {
    stageCommand();
  }, /Unsafe Vulyk managed path/);
  writeState(root, { syncPaths: ["docs/../README.md"], agentPaths: [] });
  assert.throws(() => {
    stageCommand();
  }, /Unsafe Vulyk managed path/);
  writeState(root, { syncPaths: [".git/config"], agentPaths: [] });
  assert.throws(() => {
    stageCommand();
  }, /Unsafe Vulyk managed path/);
  assert.equal(git(root, "diff", "--cached", "--name-only"), "");
});

void test("stage keeps pending removals when Git cannot update the index", () => {
  const root = fixture();
  write(root, "docs/stale.md", "old");
  commit(root);
  fs.rmSync(path.join(root, "docs/stale.md"));
  writeState(root, {
    syncPaths: [],
    agentPaths: [],
    pendingStagePaths: ["docs/stale.md"],
  });
  const indexLock = path.join(root, ".git", "index.lock");
  fs.writeFileSync(indexLock, "locked");
  process.chdir(root);
  try {
    assert.throws(() => {
      stageCommand();
    });
    assert.deepEqual(readState(root).pendingStagePaths, ["docs/stale.md"]);
  } finally {
    fs.rmSync(indexLock, { force: true });
  }
});
