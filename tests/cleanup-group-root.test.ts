// The old cleanup-group-root.test.ts pinned behaviour of the legacy
// per-dir `.vulyk` walker. That walker is gone (.vulyk is now
// the single source of truth). This file now pins applyCleanupDelta's
// set-difference semantics using fs-only fixtures.

import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { applyCleanupDelta } from "../src/lib/state.js";

const createdDirs: string[] = [];

function tmpRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-cleanup-"));
  createdDirs.push(dir);
  return dir;
}

function writeFile(filePath: string, body: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body);
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test("applyCleanupDelta removes a stale dir present in prev but not curr", () => {
  const projectRoot = tmpRoot();
  writeFile(path.join(projectRoot, "managed", "old-skill", "SKILL.md"), "old");

  applyCleanupDelta(projectRoot, ["managed/old-skill"], []);

  assert.equal(fs.existsSync(path.join(projectRoot, "managed")), false);
});

void test("applyCleanupDelta keeps a path that is still in curr", () => {
  const projectRoot = tmpRoot();
  writeFile(path.join(projectRoot, "managed", "alpha", "SKILL.md"), "alpha");

  applyCleanupDelta(projectRoot, ["managed/alpha"], ["managed/alpha"]);

  assert.equal(
    fs.existsSync(path.join(projectRoot, "managed", "alpha", "SKILL.md")),
    true,
  );
});

void test("applyCleanupDelta deletes a stale individual file but keeps sibling files", () => {
  const projectRoot = tmpRoot();
  writeFile(path.join(projectRoot, "docs", "external", "alpha.md"), "alpha");
  writeFile(path.join(projectRoot, "docs", "external", "old.md"), "old");

  applyCleanupDelta(
    projectRoot,
    ["docs/external/alpha.md", "docs/external/old.md"],
    ["docs/external/alpha.md"],
  );

  assert.equal(
    fs.existsSync(path.join(projectRoot, "docs", "external", "alpha.md")),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(projectRoot, "docs", "external", "old.md")),
    false,
  );
  // Parent directory has a remaining file -> must stay.
  assert.equal(fs.existsSync(path.join(projectRoot, "docs", "external")), true);
});

void test("applyCleanupDelta stops pruning at the project root", () => {
  const projectRoot = tmpRoot();
  // A nested file two levels deep; parent dirs become empty after deletion.
  writeFile(path.join(projectRoot, "alpha", "beta", "leaf.txt"), "leaf");

  applyCleanupDelta(projectRoot, ["alpha/beta/leaf.txt"], []);

  assert.equal(fs.existsSync(path.join(projectRoot, "alpha")), false);
  // projectRoot itself MUST NOT be removed.
  assert.equal(fs.existsSync(projectRoot), true);
});

void test("applyCleanupDelta does not delete a user file that is not in prev", () => {
  const projectRoot = tmpRoot();
  writeFile(path.join(projectRoot, "docs", "external", "alpha.md"), "alpha");
  writeFile(path.join(projectRoot, "docs", "external", "my-notes.md"), "mine");

  // prev/curr only track alpha.md; my-notes.md is invisible to the
  // lockfile-based delta. It must survive untouched.
  applyCleanupDelta(
    projectRoot,
    ["docs/external/alpha.md"],
    ["docs/external/alpha.md"],
  );

  assert.equal(
    fs.existsSync(path.join(projectRoot, "docs", "external", "my-notes.md")),
    true,
  );
});
