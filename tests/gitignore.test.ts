import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { syncCommand } from "../src/commands/sync.js";
import { agentsCommand } from "../src/commands/agents.js";
import { writeConfig } from "./fixtures.js";

void test("vulyk sync auto-adds .vulyk/cache to project's .gitignore managed block", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-gi-sync-"));
  try {
    writeConfig(path.join(dir, "vulyk.config.ts"), { entries: {} });
    const initialCwd = process.cwd();
    process.chdir(dir);
    try {
      void syncCommand();
    } finally {
      process.chdir(initialCwd);
    }
    const giPath = path.join(dir, ".gitignore");
    assert.ok(fs.existsSync(giPath), ".gitignore should exist after sync");
    const text = fs.readFileSync(giPath, "utf8");
    const blockStart = text.indexOf("# managed by vulyk");
    const blockEnd = text.indexOf("# end vulyk");
    assert.ok(blockStart >= 0, "start marker present");
    assert.ok(blockEnd > blockStart, "end marker follows start");
    const block = text.slice(blockStart, blockEnd + "# end vulyk".length);
    assert.ok(
      block.includes(".vulyk/state.json"),
      ".vulyk/state.json inside managed block",
    );
    assert.ok(
      block.includes(".vulyk/cache/"),
      ".vulyk/cache inside managed block",
    );
    assert.ok(block.includes(".vulyk/tmp/"), ".vulyk/tmp inside managed block");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test("vulyk agents auto-adds .vulyk/cache to project's .gitignore managed block", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-gi-agents-"));
  try {
    writeConfig(path.join(dir, "vulyk.config.ts"), { entries: {} });
    const initialCwd = process.cwd();
    process.chdir(dir);
    try {
      agentsCommand();
    } finally {
      process.chdir(initialCwd);
    }
    const giPath = path.join(dir, ".gitignore");
    assert.ok(fs.existsSync(giPath), ".gitignore should exist after agents");
    const text = fs.readFileSync(giPath, "utf8");
    const blockStart = text.indexOf("# managed by vulyk");
    const blockEnd = text.indexOf("# end vulyk");
    assert.ok(blockStart >= 0, "start marker present");
    assert.ok(blockEnd > blockStart, "end marker follows start");
    const block = text.slice(blockStart, blockEnd + "# end vulyk".length);
    assert.ok(
      block.includes(".vulyk/state.json"),
      ".vulyk/state.json inside managed block",
    );
    assert.ok(
      block.includes(".vulyk/cache/"),
      ".vulyk/cache inside managed block",
    );
    assert.ok(block.includes(".vulyk/tmp/"), ".vulyk/tmp inside managed block");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test("vulyk sync leaves .gitignore unchanged when .vulyk/cache already in managed block", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-gi-idempotent-"));
  try {
    writeConfig(path.join(dir, "vulyk.config.ts"), { entries: {} });
    const gi =
      "# managed by vulyk\n.agents/skills\n.vulyk/cache/\n# end vulyk\n";
    fs.writeFileSync(path.join(dir, ".gitignore"), gi, "utf8");
    const initialCwd = process.cwd();
    process.chdir(dir);
    try {
      void syncCommand();
    } finally {
      process.chdir(initialCwd);
    }
    const text = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
    assert.ok(
      text.includes(".vulyk/state.json"),
      ".vulyk/state.json still present idempotently",
    );
    assert.ok(
      text.includes(".vulyk/cache/"),
      ".vulyk/cache still present idempotently",
    );
    assert.ok(
      text.includes(".vulyk/tmp/"),
      ".vulyk/tmp still present idempotently",
    );
    // Should not have duplicated .vulyk
    assert.equal(
      text.split(".vulyk/cache/").length - 1,
      1,
      ".vulyk/cache/ appears exactly once",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
