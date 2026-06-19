import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { agentsCommand } from "../src/commands/agents.js";
import type { Manifest } from "../src/types.js";

// Track every temp project root created during the run so we can clean up.
const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-aliases-"));
  createdDirs.push(dir);
  fs.mkdirSync(path.join(dir, "src-docs"), { recursive: true });
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "src-docs", "alpha.md"),
    "# Alpha\n\nDoc body one.\n",
  );
  fs.writeFileSync(
    path.join(dir, "src-docs", "beta.md"),
    "# Beta\n\nDoc body two.\n",
  );
  return dir;
}

function writeJson(p: string, value: unknown): void {
  fs.writeFileSync(p, `${JSON.stringify(value, null, 2)}\n`);
}

void test("agentsCommand: default primary alias is AGENTS.md with summary section", async () => {
  // No `aliases` field anywhere — should fall back to the default
  // ["AGENTS.md"] with a summary section. Title and "Full documentation:"
  // link come from the source doc.
  const projectRoot = makeTempProject();
  const manifest: Manifest = {
    entries: {
      alpha: {
        source: "./src-docs/alpha.md",
        outputPaths: ["./docs/installed"],
        targets: ["src"],
        description: "Alpha entry.",
      },
    },
  };
  writeJson(path.join(projectRoot, "vulyk.json"), manifest);

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    await agentsCommand();
  } finally {
    process.chdir(initialCwd);
  }

  const agentsPath = path.join(projectRoot, "src", "AGENTS.md");
  const body = fs.readFileSync(agentsPath, "utf8");
  // Summary section with a `# Heading`, the description, and a
  // "Full documentation:" line — the universal format readable by
  // Claude Code (follows path), Codex (literal `cat` target), and
  // Hermes (just text).
  assert.match(body, /^# Alpha\n\nAlpha entry\.\n\nFull documentation:/m);
  // No bare `@<path>` at the top — the schema has no `import` mode anymore.
  assert.doesNotMatch(body.split("\n")[0] ?? "", /^@/);
});

void test("agentsCommand: secondary alias chains to primary with @<primaryPath>", async () => {
  // The second entry in the aliases array is the secondary. It gets
  // `@AGENTS.md` regardless of entry content.
  const projectRoot = makeTempProject();
  const manifest: Manifest = {
    entries: {
      alpha: {
        source: "./src-docs/alpha.md",
        outputPaths: ["./docs/installed"],
        targets: ["src"],
        aliases: ["AGENTS.md", "CLAUDE.md"],
      },
    },
  };
  writeJson(path.join(projectRoot, "vulyk.json"), manifest);

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    await agentsCommand();
  } finally {
    process.chdir(initialCwd);
  }

  const claudePath = path.join(projectRoot, "src", "CLAUDE.md");
  assert.equal(fs.existsSync(claudePath), true);
  assert.equal(fs.readFileSync(claudePath, "utf8"), "@AGENTS.md\n");
});

void test("agentsCommand: shared AGENTS.md composes multiple sections in source order with ---", async () => {
  // Multiple entries → AGENTS.md is the source-order composition of
  // their summary sections, separated by `---`. No bare @-imports at
  // the top; the schema no longer supports that mode.
  const projectRoot = makeTempProject();
  const manifest: Manifest = {
    entries: {
      alpha: {
        source: "./src-docs/alpha.md",
        outputPaths: ["./docs/installed"],
        targets: ["src"],
      },
      beta: {
        source: "./src-docs/beta.md",
        outputPaths: ["./docs/installed"],
        targets: ["src"],
      },
    },
  };
  writeJson(path.join(projectRoot, "vulyk.json"), manifest);

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    await agentsCommand();
  } finally {
    process.chdir(initialCwd);
  }

  const body = fs.readFileSync(
    path.join(projectRoot, "src", "AGENTS.md"),
    "utf8",
  );
  // First line is a `# Heading` from the first section, not a bare `@`.
  assert.match(body.split("\n")[0] ?? "", /^# /);
  // Both sections present, in source order.
  assert.match(body, /# Alpha[\s\S]+# Beta/);
  // Separated by `---`.
  assert.match(body, /\n---\n\n# Beta/);
});
