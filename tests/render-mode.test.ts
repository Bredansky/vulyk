import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { agentsCommand } from "../src/commands/agents.js";
import { resolveRenderMode } from "../src/lib/groups.js";
import type { Manifest } from "../src/types.js";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const POLICY_BODY = `# Agent Policy

Repo-wide requirements for agents.

## Code Quality

- Code MUST NOT use \`eslint-disable\` directives.
`;

const GUIDE_BODY = `# Code Organization Guide

How to organize code in this repository.
`;

function makeTempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-render-"));
  createdDirs.push(dir);
  fs.mkdirSync(path.join(dir, "src-docs"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src-docs", "agent-policy.md"), POLICY_BODY);
  fs.writeFileSync(
    path.join(dir, "src-docs", "code-organization-guide.md"),
    GUIDE_BODY,
  );
  return dir;
}

function writeConfig(p: string, value: unknown): void {
  fs.writeFileSync(p, `export default ${JSON.stringify(value, null, 2)};\n`);
}

function runAgents(projectRoot: string): void {
  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    agentsCommand();
  } finally {
    process.chdir(initialCwd);
  }
}

void test("resolveRenderMode: defaults to summary, and entry beats group beats manifest", () => {
  const manifest: Manifest = {
    render: "embed",
    groups: {
      managed: { render: "summary" },
      plain: {},
    },
    entries: {
      fromManifest: { source: "a.md" },
      fromGroup: { source: "b.md", group: "managed" },
      fromEntry: { source: "c.md", group: "managed", render: "embed" },
      groupWithoutMode: { source: "d.md", group: "plain" },
    },
  };

  assert.equal(resolveRenderMode(manifest, "fromManifest"), "embed");
  assert.equal(resolveRenderMode(manifest, "fromGroup"), "summary");
  assert.equal(resolveRenderMode(manifest, "fromEntry"), "embed");
  assert.equal(resolveRenderMode(manifest, "groupWithoutMode"), "embed");

  const bare: Manifest = { groups: {}, entries: { only: { source: "a.md" } } };
  assert.equal(resolveRenderMode(bare, "only"), "summary");
});

void test("agentsCommand: an embed entry writes the doc body instead of a pointer", () => {
  const projectRoot = makeTempProject();
  const manifest: Manifest = {
    groups: {},
    entries: {
      "agent-policy": {
        source: "./src-docs/agent-policy.md",
        outputPaths: ["./docs/managed"],
        targets: ["."],
        description: "Repo-wide rules.",
        render: "embed",
      },
    },
  };
  writeConfig(path.join(projectRoot, "vulyk.config.ts"), manifest);

  runAgents(projectRoot);

  const body = fs.readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8");
  assert.match(body, /^# Agent Policy\n/);
  assert.match(body, /## Code Quality/);
  assert.match(body, /Code MUST NOT use `eslint-disable` directives\./);
  // The body carries its own title and overview, so neither the entry's
  // description nor a path pointer is written.
  assert.doesNotMatch(body, /Full documentation:/);
  assert.doesNotMatch(body, /Repo-wide rules\./);
});

void test("agentsCommand: embed and summary entries compose in one agent file", () => {
  // karaylo's case: the policy is always in context, the guides are pointers.
  const projectRoot = makeTempProject();
  const manifest: Manifest = {
    groups: { managed: { outputPaths: ["./docs/managed"] } },
    entries: {
      "agent-policy": {
        source: "./src-docs/agent-policy.md",
        group: "managed",
        targets: ["."],
        render: "embed",
      },
      "code-organization-guide": {
        source: "./src-docs/code-organization-guide.md",
        group: "managed",
        targets: ["."],
        description: "Where code goes.",
      },
    },
  };
  writeConfig(path.join(projectRoot, "vulyk.config.ts"), manifest);

  runAgents(projectRoot);

  const body = fs.readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8");
  assert.match(body, /## Code Quality/, "the embedded body is present");
  assert.match(
    body,
    /# Code Organization Guide\n\nWhere code goes\.\n\nFull documentation: src-docs\/code-organization-guide\.md/,
    "the summary entry keeps its pointer",
  );
  assert.equal(
    body.match(/Full documentation:/g)?.length,
    1,
    "only the summary entry gets a pointer",
  );
});

void test("agentsCommand: a group render mode applies to its entries", () => {
  const projectRoot = makeTempProject();
  const manifest: Manifest = {
    groups: { managed: { outputPaths: ["./docs/managed"], render: "embed" } },
    entries: {
      "agent-policy": {
        source: "./src-docs/agent-policy.md",
        group: "managed",
        targets: ["."],
      },
    },
  };
  writeConfig(path.join(projectRoot, "vulyk.config.ts"), manifest);

  runAgents(projectRoot);

  const body = fs.readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8");
  assert.match(body, /## Code Quality/);
  assert.doesNotMatch(body, /Full documentation:/);
});

void test("agentsCommand: rendering stays idempotent for an embed entry", () => {
  const projectRoot = makeTempProject();
  const manifest: Manifest = {
    groups: {},
    entries: {
      "agent-policy": {
        source: "./src-docs/agent-policy.md",
        outputPaths: ["./docs/managed"],
        targets: ["."],
        render: "embed",
      },
    },
  };
  writeConfig(path.join(projectRoot, "vulyk.config.ts"), manifest);

  runAgents(projectRoot);
  const first = fs.readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8");
  runAgents(projectRoot);
  const second = fs.readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8");

  assert.equal(first, second, "a second run does not duplicate the body");
});
