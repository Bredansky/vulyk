import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readLockfile, writeLockfile } from "../src/lib/lockfile.js";

const mainCommit = "a".repeat(40);
const otherCommit = "b".repeat(40);

function withTempProject(callback: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-lockfile-"));
  try {
    callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeRaw(root: string, github: unknown): void {
  fs.writeFileSync(
    path.join(root, "vulyk.lock.json"),
    `${JSON.stringify({ github }, null, 2)}\n`,
  );
}

function readRaw(root: string): unknown {
  const parsed: unknown = JSON.parse(
    fs.readFileSync(path.join(root, "vulyk.lock.json"), "utf8"),
  );
  return parsed;
}

void test("empty lockfile remains a valid empty GitHub object", () => {
  withTempProject((root) => {
    assert.deepEqual(readLockfile(root).github, {});
    writeLockfile(root, { github: {} });
    assert.deepEqual(readRaw(root), { github: {} });
    assert.deepEqual({ ...readLockfile(root).github }, {});
  });
});

void test("legacy flat refs migrate to explicit ref and commit records", () => {
  withTempProject((root) => {
    writeRaw(root, {
      "Bredansky/pasika@main": mainCommit,
      "Bredansky/pasika@HEAD": otherCommit,
    });

    const lockfile = readLockfile(root);
    assert.equal(lockfile.github["Bredansky/pasika@main"], mainCommit);
    assert.equal(lockfile.github["Bredansky/pasika@HEAD"], otherCommit);
    writeLockfile(root, lockfile);

    assert.deepEqual(readRaw(root), {
      github: {
        "Bredansky/pasika": [
          { ref: "HEAD", commit: otherCommit },
          { ref: "main", commit: mainCommit },
        ],
      },
    });
    assert.equal(
      readLockfile(root).github["Bredansky/pasika@main"],
      mainCommit,
    );
  });
});

void test("explicit lockfile supports multiple refs and repositories", () => {
  withTempProject((root) => {
    writeRaw(root, {
      "example/docs": [
        { ref: "main", commit: mainCommit },
        { ref: "release", commit: otherCommit },
      ],
      "other/docs": [{ ref: "HEAD", commit: otherCommit }],
    });
    const lockfile = readLockfile(root);
    assert.equal(lockfile.github["example/docs@main"], mainCommit);
    assert.equal(lockfile.github["example/docs@release"], otherCommit);
    assert.equal(lockfile.github["other/docs@HEAD"], otherCommit);
    writeLockfile(root, lockfile);
    assert.deepEqual(readRaw(root), {
      github: {
        "example/docs": [
          { ref: "main", commit: mainCommit },
          { ref: "release", commit: otherCommit },
        ],
        "other/docs": [{ ref: "HEAD", commit: otherCommit }],
      },
    });
  });
});

void test("invalid commits, malformed entries and duplicate refs are rejected", () => {
  withTempProject((root) => {
    writeRaw(root, {
      "example/docs": [{ ref: "main", commit: "not-a-commit" }],
    });
    assert.throws(() => readLockfile(root), /invalid commit/);

    writeRaw(root, { "example/docs": [{ commit: mainCommit }] });
    assert.throws(() => readLockfile(root), /invalid GitHub ref/);

    writeRaw(root, {
      "example/docs": [
        { ref: "main", commit: mainCommit },
        { ref: "main", commit: otherCommit },
      ],
    });
    assert.throws(() => readLockfile(root), /duplicate GitHub ref/);

    writeRaw(root, { "example/docs@main": "not-a-commit" });
    assert.throws(() => readLockfile(root), /invalid commit/);
  });
});
