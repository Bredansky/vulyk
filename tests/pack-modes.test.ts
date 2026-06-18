import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { agentsCommand } from "../src/commands/agents.js";
import type { AliasSpec, Manifest } from "../src/types.js";

// Track every temp project root created during the run so we can clean up.
const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-pack-"));
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeFile(filePath: string, body: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body, "utf8");
}

interface DocProjectOpts {
  projectRoot: string;
  entryName: string;
  aliases?: AliasSpec[];
  pack?: "summary" | "import";
  docBody?: string;
  targetDir?: string;
}

/**
 * Set up a minimal project: a source file, a vulyk.json with one doc entry,
 * a `.vulyk` manifest in the install dir, and a pre-created target dir.
 * Returns nothing; the caller is expected to call `agentsCommand`.
 */
function setupDocProject(opts: DocProjectOpts): void {
  const {
    projectRoot,
    entryName,
    aliases,
    pack,
    docBody = `# My Doc\n\nThis is a doc.\n`,
    targetDir = "src",
  } = opts;
  const sourceDir = path.join(projectRoot, "src-docs");
  fs.mkdirSync(sourceDir, { recursive: true });
  writeFile(path.join(sourceDir, `${entryName}.md`), docBody);
  // Pre-create the target dir so getTargetDir doesn't fall back to projectRoot
  fs.mkdirSync(path.join(projectRoot, targetDir), { recursive: true });

  const manifest: Manifest = {
    groups: {},
    entries: {
      [entryName]: {
        source: `./src-docs/${entryName}.md`,
        outputPaths: [`./docs/installed`],
        targets: [targetDir],
        description: "This is a doc.",
        ...(aliases !== undefined ? { aliases } : {}),
        ...(pack !== undefined ? { pack } : {}),
      },
    },
  };
  writeJson(path.join(projectRoot, "vulyk.json"), manifest);
}

void test("agentsCommand: default aliases list is [AGENTS.md] which writes a summary section", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);
  setupDocProject({ projectRoot, entryName: "alpha" });

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    await agentsCommand();
  } finally {
    process.chdir(initialCwd);
  }

  const agentsPath = path.join(projectRoot, "src", "AGENTS.md");
  assert.equal(fs.existsSync(agentsPath), true);
  const body = fs.readFileSync(agentsPath, "utf8");
  assert.match(body, /This is a doc\./);
});

void test("agentsCommand: entry.aliases with CLAUDE.md generates CLAUDE.md as @AGENTS.md import by default", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);
  setupDocProject({
    projectRoot,
    entryName: "alpha",
    aliases: ["AGENTS.md", "CLAUDE.md"],
  });

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    await agentsCommand();
  } finally {
    process.chdir(initialCwd);
  }

  const claudePath = path.join(projectRoot, "src", "CLAUDE.md");
  const body = fs.readFileSync(claudePath, "utf8");
  assert.equal(body, "@AGENTS.md\n");
});

void test("agentsCommand: per-alias explicit mode 'import' on the primary emits the @import", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);
  setupDocProject({
    projectRoot,
    entryName: "alpha",
    aliases: [{ path: "AGENTS.md", mode: "import" }],
  });

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    await agentsCommand();
  } finally {
    process.chdir(initialCwd);
  }

  const agentsPath = path.join(projectRoot, "src", "AGENTS.md");
  const body = fs.readFileSync(agentsPath, "utf8");
  // Primary alias with import mode: a bare `@<relativePath>` line at the
  // top of the shared AGENTS.md. No framing (# title, description) — per
  // Claude Code's @-import convention, direct imports are line-shaped.
  assert.match(body, /^@src-docs\/alpha\.md$/m);
});

void test("agentsCommand: CLI --aliases flag overrides entry.aliases", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);
  setupDocProject({
    projectRoot,
    entryName: "alpha",
    aliases: ["AGENTS.md", "CLAUDE.md"],
  });

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    await agentsCommand({ aliases: ["AGENTS.md"] });
  } finally {
    process.chdir(initialCwd);
  }

  const agentsPath = path.join(projectRoot, "src", "AGENTS.md");
  const claudePath = path.join(projectRoot, "src", "CLAUDE.md");
  assert.equal(fs.existsSync(agentsPath), true);
  assert.equal(fs.existsSync(claudePath), false);
});

void test("agentsCommand: group.aliases is used as fallback when entry has no aliases", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-pack-"));
  createdDirs.push(projectRoot);
  const sourceDir = path.join(projectRoot, "src-docs");
  fs.mkdirSync(sourceDir, { recursive: true });
  writeFile(
    path.join(sourceDir, "alpha.md"),
    "# Group Doc\n\nGroup fallback.\n",
  );
  fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });

  const manifest: Manifest = {
    groups: {
      docs: {
        outputPaths: ["./docs/installed"],
        aliases: ["AGENTS.md", "CLAUDE.md"],
      },
    },
    entries: {
      alpha: {
        source: "./src-docs/alpha.md",
        outputPaths: ["./docs/installed"],
        targets: ["src"],
        group: "docs",
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

void test("agentsCommand: shared AGENTS.md composes imports at top, summaries after ---", async () => {
  // Regression: agent-conventions with import mode must render as a bare
  // `@<path>` line at the top of AGENTS.md, not as a framed section in
  // the middle. Per Claude Code's @-import convention, direct imports
  // are line-shaped. Summary-mode entries follow after `---`.
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-pack-"));
  createdDirs.push(projectRoot);
  fs.mkdirSync(path.join(projectRoot, "src-docs"), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  writeFile(
    path.join(projectRoot, "src-docs", "agent-conventions.md"),
    "# Agent Conventions\n\nCross-project rules.\n",
  );
  writeFile(
    path.join(projectRoot, "src-docs", "project-structure.md"),
    "# Project Structure\n\nHow we organize code.\n",
  );

  const manifest: Manifest = {
    entries: {
      "agent-conventions": {
        source: "./src-docs/agent-conventions.md",
        outputPaths: ["./docs/installed"],
        targets: ["src"],
        aliases: [{ path: "AGENTS.md", mode: "import" }],
      },
      "project-structure": {
        source: "./src-docs/project-structure.md",
        outputPaths: ["./docs/installed"],
        targets: ["src"],
        // No aliases — defaults to AGENTS.md with summary mode.
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
  // The bare @-import line must be the first line — no `# Agent
  // Conventions` heading, no description, no framing. The path is
  // relative to the project root, not the installed doc location, so
  // Claude Code can resolve it from the alias file.
  const firstLine = body.split("\n")[0];
  assert.equal(firstLine, "@src-docs/agent-conventions.md");
  // Summary section appears after the `---` separator.
  assert.match(body, /\n---\n\n# Project Structure\n/);
  // No framed "Agent Conventions" section in the body.
  assert.doesNotMatch(body, /^# Agent Conventions/m);
});
