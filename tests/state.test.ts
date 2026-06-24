import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readState, writeState, applyCleanupDelta } from "../src/lib/state.js";

const createdDirs: string[] = [];

function tmpRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-state-"));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test("readState returns empty state when .vulyk does not exist", () => {
  const dir = tmpRoot();
  const r = readState(dir);
  assert.deepEqual(r, { syncPaths: [], agentPaths: [] });
  assert.equal(fs.existsSync(path.join(dir, ".vulyk")), false);
});

void test("writeState then readState roundtrips agent + sync paths", () => {
  const dir = tmpRoot();
  writeState(dir, {
    syncPaths: ["docs/external/alpha.md", "managed-skills/beta"],
    agentPaths: ["src/AGENTS.md"],
  });
  const r = readState(dir);
  assert.deepEqual(r.syncPaths, [
    "docs/external/alpha.md",
    "managed-skills/beta",
  ]);
  assert.deepEqual(r.agentPaths, ["src/AGENTS.md"]);
});

void test("writeState writes \u{1F36F}-lines first, \u{1F41D}-lines second, sorted within each", () => {
  const dir = tmpRoot();
  writeState(dir, {
    syncPaths: ["z.md", "a.md"],
    agentPaths: ["CLAUDE.md", "AGENTS.md"],
  });
  const text = fs.readFileSync(path.join(dir, ".vulyk"), "utf8");
  assert.equal(
    text,
    "\u{1F36F} AGENTS.md\n\u{1F36F} CLAUDE.md\n\u{1F41D} a.md\n\u{1F41D} z.md\n",
  );
});

void test("writeState is atomic (writes to .tmp then renames)", () => {
  const dir = tmpRoot();
  writeState(dir, { syncPaths: ["x"], agentPaths: [] });
  assert.equal(fs.existsSync(path.join(dir, ".vulyk")), true, ".vulyk present");
  assert.equal(
    fs.existsSync(path.join(dir, ".vulyk.tmp")),
    false,
    "no stale .tmp",
  );
});

void test("writeState dedupes identical lines within + across kind", () => {
  const dir = tmpRoot();
  writeState(dir, {
    syncPaths: ["dup.md", "dup.md"],
    agentPaths: ["X.md", "X.md", "Y.md"],
  });
  const text = fs.readFileSync(path.join(dir, ".vulyk"), "utf8");
  assert.equal(text, "\u{1F36F} X.md\n\u{1F36F} Y.md\n\u{1F41D} dup.md\n");
});

void test("readState ignores lines without \u{1F36F} / \u{1F41D} prefix", () => {
  const dir = tmpRoot();
  fs.writeFileSync(
    path.join(dir, ".vulyk"),
    "\u{1F36F} good\nbogus line\n\u{1F41D} also-good\n",
  );
  const r = readState(dir);
  assert.deepEqual(r.agentPaths, ["good"]);
  assert.deepEqual(r.syncPaths, ["also-good"]);
});

void test("readState tolerates a corrupt .vulyk by returning empty state", () => {
  const dir = tmpRoot();
  fs.writeFileSync(path.join(dir, ".vulyk"), "\xff\xfe\xfd garbage");
  const r = readState(dir);
  assert.deepEqual(r, { syncPaths: [], agentPaths: [] });
});

void test("applyCleanupDelta deletes paths in prev not in curr", () => {
  const dir = tmpRoot();
  fs.writeFileSync(path.join(dir, "stale.txt"), "stale");
  fs.writeFileSync(path.join(dir, "keep.txt"), "keep");
  applyCleanupDelta(dir, ["stale.txt", "keep.txt"], ["keep.txt"]);
  assert.equal(fs.existsSync(path.join(dir, "stale.txt")), false);
  assert.equal(fs.existsSync(path.join(dir, "keep.txt")), true);
});

void test("applyCleanupDelta prunes empty parent dirs up to projectRoot", () => {
  const dir = tmpRoot();
  const onlyChild = path.join(dir, "nested", "deeper", "only.txt");
  fs.mkdirSync(path.dirname(onlyChild), { recursive: true });
  fs.writeFileSync(onlyChild, "x");
  applyCleanupDelta(dir, ["nested/deeper/only.txt"], []);
  assert.equal(fs.existsSync(onlyChild), false);
  assert.equal(fs.existsSync(path.dirname(onlyChild)), false);
  assert.equal(fs.existsSync(path.join(dir, "nested")), false);
});

void test("applyCleanupDelta doesn't prune a parent dir that has unrelated content", () => {
  const dir = tmpRoot();
  fs.mkdirSync(path.join(dir, "sibling"), { recursive: true });
  fs.writeFileSync(path.join(dir, "sibling", "a.md"), "x");
  fs.writeFileSync(path.join(dir, "sibling", "b.md"), "y");
  applyCleanupDelta(dir, ["sibling/a.md"], []);
  assert.equal(fs.existsSync(path.join(dir, "sibling", "a.md")), false);
  assert.equal(fs.existsSync(path.join(dir, "sibling", "b.md")), true);
  assert.equal(fs.existsSync(path.join(dir, "sibling")), true);
});
void test("writeState keeps both 🍯- and 🐝-prefixed lines even if the path overlaps", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-cross-"));
  try {
    writeState(dir, {
      syncPaths: ["README.md"],
      agentPaths: ["README.md"],
    });
    const text = fs.readFileSync(path.join(dir, ".vulyk"), "utf8");
    assert.equal(text, "\u{1F36F} README.md\n\u{1F41D} README.md\n");
    const round = readState(dir);
    assert.deepEqual(round, {
      syncPaths: ["README.md"],
      agentPaths: ["README.md"],
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
