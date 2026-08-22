import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  copyFilePreservingBinary,
  normalizeLineEndings,
  writeTextFile,
} from "../src/lib/text.js";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test("normalizeLineEndings converts CRLF and bare CR to LF", () => {
  assert.equal(
    normalizeLineEndings("one\r\ntwo\rthree\nfour"),
    "one\ntwo\nthree\nfour",
  );
});

void test("writeTextFile writes UTF-8 text with LF endings", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-text-"));
  createdDirs.push(dir);
  const filePath = path.join(dir, "AGENTS.md");

  writeTextFile(filePath, "# Rules\r\n\r\nKeep going\r");

  assert.deepEqual(
    fs.readFileSync(filePath),
    Buffer.from("# Rules\n\nKeep going\n", "utf8"),
  );
});

void test("copyFilePreservingBinary normalizes text files but preserves binary files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-copy-"));
  createdDirs.push(dir);
  const textSource = path.join(dir, "source.md");
  const textDest = path.join(dir, "dest.md");
  const binarySource = path.join(dir, "source.bin");
  const binaryDest = path.join(dir, "dest.bin");

  fs.writeFileSync(textSource, "# Guide\r\n");
  fs.writeFileSync(binarySource, Buffer.from([0, 255, 13, 10]));

  copyFilePreservingBinary(textSource, textDest);
  copyFilePreservingBinary(binarySource, binaryDest);

  assert.deepEqual(fs.readFileSync(textDest), Buffer.from("# Guide\n", "utf8"));
  assert.deepEqual(fs.readFileSync(binaryDest), Buffer.from([0, 255, 13, 10]));
});
