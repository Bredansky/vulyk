import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  emptyState,
  readState,
  writeState,
  applyCleanupDelta,
  isStringArray,
  parseLockObject,
  LOCK_FILENAME,
} from "../src/lib/state.js";

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

void test("emptyState returns a fresh version-1 state with empty arrays", () => {
  const s = emptyState();
  assert.equal(s.version, 1);
  assert.deepEqual(s.syncPaths, []);
  assert.deepEqual(s.agentPaths, []);
});

void test("writeState then readState roundtrips the data", () => {
  const dir = tmpRoot();
  writeState(dir, {
    version: 1,
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

void test("writeState is atomic (writes to .tmp then renames)", () => {
  const dir = tmpRoot();
  writeState(dir, { version: 1, syncPaths: ["x"], agentPaths: [] });
  assert.equal(
    fs.existsSync(path.join(dir, LOCK_FILENAME)),
    true,
    "lockfile present after write",
  );
  assert.equal(
    fs.existsSync(path.join(dir, `${LOCK_FILENAME}.tmp`)),
    false,
    "no stale .tmp left behind",
  );
});

void test("writeState normalises its arrays to sorted order", () => {
  const dir = tmpRoot();
  writeState(dir, {
    version: 1,
    syncPaths: ["z", "a", "m"],
    agentPaths: ["y", "b"],
  });
  const written = parseLockObject(
    JSON.parse(fs.readFileSync(path.join(dir, LOCK_FILENAME), "utf8")),
  );
  assert.ok(written, "lockfile should parse cleanly");
  assert.deepEqual(written.syncPaths, ["a", "m", "z"]);
  assert.deepEqual(written.agentPaths, ["b", "y"]);
  // The type guard should reject non-string-array fields.
  assert.equal(isStringArray(["a", "b"]), true);
  assert.equal(isStringArray(["a", 2]), false);
  assert.equal(isStringArray("nope"), false);
});

void test("readState returns empty state when neither lockfile nor legacy markers exist", () => {
  const dir = tmpRoot();
  const r = readState(dir);
  assert.deepEqual(r, { version: 1, syncPaths: [], agentPaths: [] });
  assert.equal(fs.existsSync(path.join(dir, LOCK_FILENAME)), false);
});

void test("readState tolerates a corrupt lockfile by falling back to migration", () => {
  const dir = tmpRoot();
  fs.writeFileSync(path.join(dir, LOCK_FILENAME), "not-json");
  const r = readState(dir);
  assert.deepEqual(r, { version: 1, syncPaths: [], agentPaths: [] });
});

void test("applyCleanupDelta deletes paths in prev not in curr", () => {
  const dir = tmpRoot();
  const staleFile = path.join(dir, "stale.txt");
  const keepFile = path.join(dir, "keep.txt");
  fs.writeFileSync(staleFile, "stale");
  fs.writeFileSync(keepFile, "keep");

  applyCleanupDelta(dir, ["stale.txt", "keep.txt"], ["keep.txt"]);

  assert.equal(fs.existsSync(staleFile), false, "stale deleted");
  assert.equal(fs.existsSync(keepFile), true, "keep preserved");
});

void test("applyCleanupDelta prunes empty parent directories up to projectRoot", () => {
  const dir = tmpRoot();
  const parentDir = path.join(dir, "nested", "deeper");
  fs.mkdirSync(parentDir, { recursive: true });
  const onlyChild = path.join(parentDir, "only.txt");
  fs.writeFileSync(onlyChild, "x");

  applyCleanupDelta(dir, ["nested/deeper/only.txt"], []);

  assert.equal(fs.existsSync(onlyChild), false);
  assert.equal(fs.existsSync(parentDir), false);
  assert.equal(fs.existsSync(path.join(dir, "nested")), false);
});

void test("applyCleanupDelta does not prune a parent dir that still has unrelated content", () => {
  const dir = tmpRoot();
  const siblingDir = path.join(dir, "sibling");
  fs.mkdirSync(siblingDir, { recursive: true });
  const targetFile = path.join(siblingDir, "a.md");
  const otherFile = path.join(siblingDir, "b.md");
  fs.writeFileSync(targetFile, "x");
  fs.writeFileSync(otherFile, "y");

  applyCleanupDelta(dir, ["sibling/a.md"], []);

  assert.equal(fs.existsSync(targetFile), false, "deleted only a.md");
  assert.equal(fs.existsSync(otherFile), true, "b.md untouched");
  assert.equal(fs.existsSync(siblingDir), true, "parent preserved");
});

void test("applyCleanupDelta does not delete a path that's in both prev and curr", () => {
  const dir = tmpRoot();
  const file = path.join(dir, "shared.md");
  fs.writeFileSync(file, "x");

  applyCleanupDelta(dir, ["shared.md"], ["shared.md"]);

  assert.equal(fs.existsSync(file), true);
});
