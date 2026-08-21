import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveFetchedInstallSource } from "../src/lib/fetcher.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-fetcher-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

void describe("resolveFetchedInstallSource", () => {
  void it("unwraps a fetched GitHub blob into a file install", () => {
    const filePath = path.join(tmpDir, "agent-conventions.md");
    fs.writeFileSync(filePath, "# Agent Conventions");

    assert.equal(
      resolveFetchedInstallSource(
        "https://github.com/example/docs/blob/main/docs/agent-conventions.md",
        tmpDir,
      ),
      filePath,
    );
  });

  void it("keeps a fetched tree as a directory install", () => {
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# Guide");

    assert.equal(
      resolveFetchedInstallSource(
        "https://github.com/example/docs/tree/main/docs/guide",
        tmpDir,
      ),
      tmpDir,
    );
  });
});
