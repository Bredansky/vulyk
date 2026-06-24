import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  migrateFromLegacyMarkers,
  readState,
  writeState,
} from "../src/lib/state.js";

const createdDirs: string[] = [];

function tmpRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-migrate-"));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function write(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

void test("migrateFromLegacyMarkers splits AGENTS.md into agentPaths", () => {
  const dir = tmpRoot();
  const outDir = path.join(dir, "docs", "external");
  fs.mkdirSync(outDir, { recursive: true });
  write(path.join(outDir, "AGENTS.md"), "# docs\n");
  write(path.join(outDir, "guide.md"), "# guide\n");
  write(path.join(outDir, ".vulyk"), "🍯 AGENTS.md\n🍯 guide.md\n");

  const r = migrateFromLegacyMarkers(dir);

  assert.deepEqual(r.syncPaths, ["docs/external/guide.md"]);
  assert.deepEqual(r.agentPaths, ["docs/external/AGENTS.md"]);
  assert.equal(
    fs.existsSync(path.join(outDir, ".vulyk")),
    false,
    "legacy marker deleted",
  );
});

void test("migrateFromLegacyMarkers splits CLAUDE.md into agentPaths", () => {
  const dir = tmpRoot();
  const targetDir = path.join(dir, "src");
  fs.mkdirSync(targetDir, { recursive: true });
  write(path.join(targetDir, "CLAUDE.md"), "@AGENTS.md\n");
  write(path.join(targetDir, ".vulyk"), "🍯 CLAUDE.md\n");

  const r = migrateFromLegacyMarkers(dir);
  assert.deepEqual(r.agentPaths, ["src/CLAUDE.md"]);
  assert.deepEqual(r.syncPaths, []);
});

void test("migrateFromLegacyMarkers handles a legacy bare 🍯 marker (dir-install)", () => {
  const dir = tmpRoot();
  const installDir = path.join(dir, "managed-skills", "alpha");
  fs.mkdirSync(installDir, { recursive: true });
  // Legacy single-line marker: just the honey emoji, no filename.
  write(path.join(installDir, ".vulyk"), "🍯\n");

  const r = migrateFromLegacyMarkers(dir);
  assert.deepEqual(r.syncPaths, ["managed-skills/alpha"]);
  assert.equal(
    fs.existsSync(path.join(installDir, ".vulyk")),
    false,
    "legacy marker deleted",
  );
});

void test("migrateFromLegacyMarkers returns empty state when no markers present", () => {
  const dir = tmpRoot();
  const r = migrateFromLegacyMarkers(dir);
  assert.deepEqual(r, { version: 1, syncPaths: [], agentPaths: [] });
});

void test("readState triggers migration transparently when no lockfile exists", () => {
  const dir = tmpRoot();
  const outDir = path.join(dir, "docs", "external");
  fs.mkdirSync(outDir, { recursive: true });
  write(path.join(outDir, "alpha.md"), "# alpha\n");
  write(path.join(outDir, "AGENTS.md"), "# agents\n");
  write(path.join(outDir, ".vulyk"), "🍯 alpha.md\n🍯 AGENTS.md\n");

  const r = readState(dir);

  assert.deepEqual(r.syncPaths, ["docs/external/alpha.md"]);
  assert.deepEqual(r.agentPaths, ["docs/external/AGENTS.md"]);
  assert.equal(
    fs.existsSync(path.join(outDir, ".vulyk")),
    false,
    "migrated marker deleted as part of readState",
  );
});

void test("readState does not re-migrate when the lockfile is present", () => {
  const dir = tmpRoot();
  // Pre-existing lockfile with a specific state.
  writeState(dir, {
    version: 1,
    syncPaths: ["already-migrated/alpha.md"],
    agentPaths: [],
  });
  // A legacy marker that would have been picked up by migration if
  // readState were re-running it. Should be left untouched.
  write(path.join(dir, "stale", ".vulyk"), "🍯 post-migration.md\n");

  const r = readState(dir);

  assert.deepEqual(r.syncPaths, ["already-migrated/alpha.md"]);
  // The legacy marker survives because migration does not re-run.
  assert.equal(fs.existsSync(path.join(dir, "stale", ".vulyk")), true);
});
