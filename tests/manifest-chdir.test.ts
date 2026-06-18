import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { findManifest } from "../src/lib/manifest.js";

// Track every temp project root created during the run so we can clean up.
const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
});

void test("findManifest: chdirs to project root so resolvePath is correct from subdirs", () => {
  // Regression: vulyk commands used to call `path.resolve(p)` (CWD-relative)
  // for manifest paths, which broke when vulyk was invoked from a subdir of
  // the project. The fix anchors the process CWD to the project root the
  // moment the manifest is found, so all downstream `path.resolve` calls
  // resolve against project root regardless of where the user ran from.
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-chdir-"));
  createdDirs.push(projectRoot);
  fs.writeFileSync(
    path.join(projectRoot, "vulyk.json"),
    '{"groups":{},"entries":{}}',
  );
  const subdir = path.join(projectRoot, "src", "components", "deep");
  fs.mkdirSync(subdir, { recursive: true });

  const initialCwd = process.cwd();
  process.chdir(subdir);
  try {
    const manifestPath = findManifest();
    assert.ok(manifestPath);
    // CWD must have been anchored to the project root. Compare via
    // realpath because macOS resolves /var/folders → /private/var/folders
    // when reporting cwd.
    assert.equal(fs.realpathSync(process.cwd()), fs.realpathSync(projectRoot));
  } finally {
    process.chdir(initialCwd);
  }
});

void test("findManifest: returns null when no manifest is reachable", () => {
  // No manifest anywhere up the tree. CWD must not change.
  const initialCwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-noman-"));
  createdDirs.push(tmp);
  process.chdir(tmp);
  try {
    const result = findManifest();
    assert.equal(result, null);
    assert.equal(fs.realpathSync(process.cwd()), fs.realpathSync(tmp));
  } finally {
    process.chdir(initialCwd);
  }
});
