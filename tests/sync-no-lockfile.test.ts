import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { syncCommand } from "../src/commands/sync.js";
import { readState } from "../src/lib/state.js";

async function inTempProject(
  config: unknown,
  callback: (root: string) => Promise<void>,
): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-no-lock-"));
  const previousCwd = process.cwd();
  try {
    fs.writeFileSync(
      path.join(root, "vulyk.config.ts"),
      `export default ${JSON.stringify(config)};\n`,
    );
    process.chdir(root);
    await callback(root);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

void test(
  "sync uses configuration directly and does not create vulyk.lock.json",
  { skip: process.platform === "win32" },
  async () => {
    await inTempProject(
      {
        groups: { docs: { outputPaths: ["docs/managed"] } },
        entries: { guide: { source: "sources/guide.md", group: "docs" } },
      },
      async (root) => {
        fs.mkdirSync(path.join(root, "sources"), { recursive: true });
        fs.writeFileSync(path.join(root, "sources", "guide.md"), "# Guide\n");
        assert.equal(await syncCommand(), true);
        assert.equal(fs.existsSync(path.join(root, "vulyk.lock.json")), false);
        assert.ok(readState(root).syncPaths.length > 0);
      },
    );
  },
);

void test(
  "sync refuses moving GitHub refs instead of silently creating a lockfile",
  { skip: process.platform === "win32" },
  async () => {
    await inTempProject(
      {
        groups: { docs: { outputPaths: ["docs/managed"] } },
        entries: {
          guide: {
            source: "https://github.com/example/docs/blob/main/docs/guide.md",
            group: "docs",
          },
        },
      },
      async (root) => {
        assert.equal(await syncCommand(), false);
        assert.equal(fs.existsSync(path.join(root, "vulyk.lock.json")), false);
        assert.equal(
          fs.existsSync(path.join(root, ".vulyk", "state.json")),
          false,
        );
      },
    );
  },
);
