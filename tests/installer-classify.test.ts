import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { classifySource } from "../src/lib/installer.js";

const createdDirs: string[] = [];

function tmpRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-classify-"));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test("classifySource: a single-file source returns a file install", () => {
  const root = tmpRoot();
  const filePath = path.join(root, "standalone.md");
  fs.writeFileSync(filePath, "# standalone\n");

  const result = classifySource(filePath, false);

  assert.equal(result.isFileInstall, true);
  assert.equal(result.effectiveSrc, filePath);
  assert.equal(result.ext, ".md");
});

void test("classifySource: a single-file-in-dir (1 file, 0 dirs) returns a file install (legacy blob shape)", () => {
  // This is the typical shape of a remote blob fetched into a temp dir,
  // e.g. fetcher.fetchGitSource for a pasika/blob URL. The unwrap is
  // intentional so the flat-file install lands at <output>/<name><ext>.
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, "README.md"), "# readme\n");

  const result = classifySource(root, false);

  assert.equal(result.isFileInstall, true);
  assert.equal(result.effectiveSrc, path.join(root, "README.md"));
  assert.equal(result.ext, ".md");
});

void test("classifySource: a tree source with 1 file AND subdirs returns a directory install", () => {
  // Regression: pasika/tree/<sha>/docs/documentation-guide contains
  // {"documentation-guide.md", "_templates/", "references/", "rules/"}.
  // The previous heuristic (fileNames.length === 1) wrongly unwrapped
  // this to a flat file install, silently dropping the subdirs.
  // The fix requires BOTH fileNames.length === 1 AND dirNames.length === 0
  // for the unwrap; any subdirs collapse back to a directory install.
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, "documentation-guide.md"), "# docs\n");
  fs.mkdirSync(path.join(root, "_templates"));
  fs.writeFileSync(path.join(root, "_templates", "rule.md"), "r\n");
  fs.mkdirSync(path.join(root, "references"));
  fs.writeFileSync(path.join(root, "references", "a.md"), "a\n");
  fs.mkdirSync(path.join(root, "rules"));
  fs.writeFileSync(path.join(root, "rules", "b.md"), "b\n");

  const result = classifySource(root, false);

  assert.equal(result.isFileInstall, false, "must install as directory");
  assert.equal(result.effectiveSrc, root);
  assert.equal(result.ext, "");
});

void test("classifySource: an empty dir returns a directory install", () => {
  const root = tmpRoot();

  const result = classifySource(root, false);

  assert.equal(result.isFileInstall, false);
  assert.equal(result.effectiveSrc, root);
});

void test("classifySource: preserveFolderForSingleFile forces directory install even for 1-file-+-0-dir shape", () => {
  // Some local sources intentionally have a single-file-in-dir layout
  // (e.g. a docs folder with one README). preserveFolderForSingleFile
  // opts out of the unwrap heuristic so the folder shape is kept.
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, "README.md"), "# x\n");

  const result = classifySource(root, true);

  assert.equal(result.isFileInstall, false);
  assert.equal(result.effectiveSrc, root);
});
