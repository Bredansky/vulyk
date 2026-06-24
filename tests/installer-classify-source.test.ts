import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { classifySource } from "../src/lib/installer.js";

const createdDirs: string[] = [];

function tmpRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-classify-source-"));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test("classifySource: tree URL with 1 file + 3 subdirs installs as a directory", () => {
  // Regression for the silent-drop bug fixed in v0.10.2: a tree source
  // like pasika/tree/<sha>/docs/documentation-guide containing exactly
  // {documentation-guide.md, _templates/, references/, rules/} was
  // previously collapsed to a flat-file install because the unwrap
  // heuristic counted only files. The 3 subdirs (and everything beneath
  // them) were dropped silently. After the fix, this shape MUST install
  // as a directory so the subdirs survive.
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, "documentation-guide.md"), "# docs\n");
  fs.mkdirSync(path.join(root, "_templates"));
  fs.writeFileSync(path.join(root, "_templates", "rule.md"), "rule\n");
  fs.mkdirSync(path.join(root, "references"));
  fs.writeFileSync(path.join(root, "references", "a.md"), "a\n");
  fs.mkdirSync(path.join(root, "rules"));
  fs.writeFileSync(path.join(root, "rules", "b.md"), "b\n");

  const result = classifySource(root, false);

  assert.equal(
    result.isFileInstall,
    false,
    "1 file + 3 subdirs must classify as directory install, not flat file",
  );
  assert.equal(result.effectiveSrc, root);
  assert.equal(result.ext, "");
});

void test("classifySource: 1 file + 0 dirs (legacy blob unwrap) installs as a flat file", () => {
  // The shape of a remote blob fetched into a temp dir, e.g.
  // pasika/blob/<sha>/foo.md. The unwrap heuristic must still fire
  // here so flat-file sources don't regress after the v0.10.2 fix
  // tightened the unwrap predicate to require `dirNames.length === 0`.
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, "README.md"), "# readme\n");

  const result = classifySource(root, false);

  assert.equal(result.isFileInstall, true);
  assert.equal(result.effectiveSrc, path.join(root, "README.md"));
  assert.equal(result.ext, ".md");
});
