// Regression tests for target routing and agent-file placement.
// `vulyk agents` once repeated a doc's section per target that resolves to
//    the same directory (e.g. several repo-root file targets all place into
//    root AGENTS.md), producing N identical `---`-separated sections.
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { agentsCommand } from "../src/commands/agents.js";
import { findDocsForFile, findTargetsForDoc } from "../src/lib/docs.js";

function makeTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-routing-targets-"));
}

function writeConfig(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `export default ${JSON.stringify(value, null, 2)};\n`,
    "utf8",
  );
}

function writeFile(filePath: string, body: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body, "utf8");
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const createdDirs: string[] = [];

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test("agentsCommand writes one section when an entry's targets all resolve to the same dir", () => {
  // Three repo-root file targets → three contributions to the same bucket
  // (root AGENTS.md). Before the dedup fix the section appeared 3×.
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeConfig(path.join(projectRoot, "vulyk.config.ts"), {
    groups: {},
    entries: {
      "adoption-guide": {
        source: "docs/adoption-guide.md",
        targets: ["eslint.config.ts", "package.json", "vulyk.config.ts"],
        description: "Framework adoption contract.",
      },
    },
  });
  writeFile(
    path.join(projectRoot, "docs", "adoption-guide.md"),
    "# Framework Adoption Guide\nBody.\n",
  );

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    agentsCommand();

    const agentsMd = fs.readFileSync(
      path.join(projectRoot, "AGENTS.md"),
      "utf8",
    );
    assert.equal(
      countOccurrences(agentsMd, "# Framework Adoption Guide"),
      1,
      `section appears exactly once; got:\n${agentsMd}`,
    );
    // The path pointer should also appear only once.
    assert.equal(
      countOccurrences(agentsMd, "Framework Adoption Guide"),
      1,
      `no duplicated pointer; got:\n${agentsMd}`,
    );
    // Nothing else was littered — targets resolved to root, root only.
    assert.equal(
      fs.existsSync(path.join(projectRoot, "eslint.config.ts", "AGENTS.md")),
      false,
      "no nested agent file for a plain file target",
    );
  } finally {
    process.chdir(initialCwd);
  }
});

void test("targets route docs and place agent files", () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeConfig(path.join(projectRoot, "vulyk.config.ts"), {
    groups: {},
    entries: {
      "code-org": {
        source: "docs/code-org.md",
        targets: ["src/**"],
        description: "Code organization rules.",
      },
    },
  });
  writeFile(
    path.join(projectRoot, "docs", "code-org.md"),
    "# Code Organization Guide\nBody.\n",
  );

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    const matched = findDocsForFile("src/features/poster.tsx");
    assert.equal(matched.docs.length, 1, "targets still route find-docs");

    const unmatched = findDocsForFile("scripts/build.ts");
    assert.equal(unmatched.docs.length, 0, "targets exclude unrelated files");

    const targets = findTargetsForDoc("docs/code-org.md");
    assert.deepEqual(
      targets.targets.map((target) => target.path),
      ["src/**"],
      "find-targets reports the configured targets",
    );

    agentsCommand();
    assert.equal(
      fs.existsSync(path.join(projectRoot, "src", "AGENTS.md")),
      true,
      "targets still place agent files under src/",
    );
    assert.equal(
      fs.existsSync(path.join(projectRoot, "AGENTS.md")),
      false,
      "no root agent file when targets point at src/",
    );
  } finally {
    process.chdir(initialCwd);
  }
});
