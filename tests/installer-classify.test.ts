import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { classifySource } from "../src/lib/installer.js";

let tmpDir: string;

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-classify-"));
}

beforeEach(() => {
  tmpDir = tmpRoot();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

void describe("classifySource", () => {
  void it("classifies a single file as a file install", () => {
    const filePath = path.join(tmpDir, "readme.md");
    fs.writeFileSync(filePath, "# Hello");

    const result = classifySource(filePath);

    assert.equal(result.isFileInstall, true);
    assert.equal(result.effectiveSrc, filePath);
    assert.equal(result.ext, ".md");
  });

  void it("classifies a directory with one file as a folder install", () => {
    const dirPath = path.join(tmpDir, "single-file-dir");
    fs.mkdirSync(dirPath);
    fs.writeFileSync(path.join(dirPath, "readme.md"), "# Hello");

    const result = classifySource(dirPath);

    assert.equal(result.isFileInstall, false);
    assert.equal(result.effectiveSrc, dirPath);
    assert.equal(result.ext, "");
  });

  void it("classifies a directory with files and subdirectories as a folder install", () => {
    const dirPath = path.join(tmpDir, "tree-source");
    fs.mkdirSync(dirPath);
    fs.writeFileSync(path.join(dirPath, "index.md"), "# Index");
    fs.mkdirSync(path.join(dirPath, "sub"));
    fs.writeFileSync(path.join(dirPath, "sub", "nested.md"), "# Nested");

    const result = classifySource(dirPath);

    assert.equal(result.isFileInstall, false);
    assert.equal(result.effectiveSrc, dirPath);
    assert.equal(result.ext, "");
  });

  void it("classifies an empty directory as a folder install", () => {
    const dirPath = path.join(tmpDir, "empty-dir");
    fs.mkdirSync(dirPath);

    const result = classifySource(dirPath);

    assert.equal(result.isFileInstall, false);
    assert.equal(result.effectiveSrc, dirPath);
    assert.equal(result.ext, "");
  });
});
