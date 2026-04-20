import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { docsCommand } from "../src/commands/docs.js";
import { docAddCommand } from "../src/commands/doc-add.js";
import { disableCommand, enableCommand } from "../src/commands/toggle.js";
import { removeCommand } from "../src/commands/remove.js";
import { findDocsForFile, findTargetsForDoc } from "../src/lib/docs.js";

function makeTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-command-test-"));
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeFile(filePath: string, body: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body, "utf8");
}

const createdDirs: string[] = [];

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

void test("disableCommand, enableCommand, and removeCommand manage a local skill lifecycle", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeJson(path.join(projectRoot, "vulyk.json"), {
    skills: {
      outputPaths: ["managed-skills"],
      enabled: ["alpha"],
      entries: {
        alpha: {
          source: "sources/alpha",
        },
      },
    },
  });
  writeFile(
    path.join(projectRoot, "sources", "alpha", "SKILL.md"),
    "---\nname: alpha\n---\n\n# Alpha\n",
  );
  writeFile(
    path.join(projectRoot, "managed-skills", "alpha", "SKILL.md"),
    "---\nname: alpha\n---\n\n# Alpha\n",
  );
  writeFile(
    path.join(projectRoot, "managed-skills", "alpha", ".vulyk"),
    "🍯\n",
  );

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    disableCommand("alpha");
    assert.equal(
      fs.existsSync(path.join(projectRoot, "managed-skills", "alpha")),
      false,
    );

    await enableCommand("alpha");
    assert.equal(
      fs.existsSync(
        path.join(projectRoot, "managed-skills", "alpha", "SKILL.md"),
      ),
      true,
    );

    removeCommand("alpha");
    assert.equal(
      fs.existsSync(path.join(projectRoot, "managed-skills", "alpha")),
      false,
    );

    const manifestBody = fs.readFileSync(
      path.join(projectRoot, "vulyk.json"),
      "utf8",
    );
    assert.doesNotMatch(manifestBody, /"alpha":/);
  } finally {
    process.chdir(initialCwd);
  }
});

void test("docAddCommand tracks a remote doc and docs queries distinguish local and external docs", () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeJson(path.join(projectRoot, "vulyk.json"), {
    docs: {
      rules: {
        claude: {
          match: [".claude/**"],
          outputPaths: ["docs/external"],
          also: ["CLAUDE.md"],
        },
      },
      entries: {
        "local-guide": {
          source: "docs/local-guide.md",
          targets: ["src/app"],
          description: "Local app guidance.",
          gitignoreGenerated: false,
        },
      },
    },
  });
  writeFile(
    path.join(projectRoot, "docs", "local-guide.md"),
    "# Local Guide\n",
  );
  writeFile(
    path.join(projectRoot, "src", "app", "page.tsx"),
    "export default null;\n",
  );
  writeFile(
    path.join(projectRoot, "docs", "external", "claude-statusline.md"),
    "# Statusline\n",
  );

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    docAddCommand("https://example.com/claude-statusline.md", {
      targets: [".claude/settings.json"],
      description: "External statusline guidance.",
    });

    const manifestBody = fs.readFileSync(
      path.join(projectRoot, "vulyk.json"),
      "utf8",
    );
    assert.match(
      manifestBody,
      /"claude-statusline":\s*\{\s*"source": "https:\/\/example.com\/claude-statusline.md"/,
    );

    docsCommand({});

    const appDocs = findDocsForFile("src/app/page.tsx");
    assert.equal(appDocs.docs.length, 1);
    const [appDoc] = appDocs.docs;
    assert.ok(appDoc);
    assert.equal(appDoc.kind, "local");
    assert.equal(appDoc.name, "Local Guide");

    const claudeDocs = findDocsForFile(".claude/settings.json");
    assert.equal(claudeDocs.docs.length, 1);
    const [claudeDoc] = claudeDocs.docs;
    assert.ok(claudeDoc);
    assert.equal(claudeDoc.kind, "external");
    assert.equal(claudeDoc.name, "Statusline");

    const externalTargets = findTargetsForDoc(
      "docs/external/claude-statusline.md",
    );
    assert.equal(externalTargets.kind, "external");
    assert.equal(externalTargets.targets[0]?.path, ".claude/settings.json");

    const localTargets = findTargetsForDoc("docs/local-guide.md");
    assert.equal(localTargets.kind, "local");
    assert.equal(localTargets.targets[0]?.path, "src/app");

    assert.equal(
      fs.existsSync(path.join(projectRoot, ".claude", "AGENTS.md")),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".claude", "CLAUDE.md")),
      true,
    );

    const gitignoreBody = fs.readFileSync(
      path.join(projectRoot, ".gitignore"),
      "utf8",
    );
    assert.match(gitignoreBody, /# managed by vulyk/);
    assert.match(gitignoreBody, /CLAUDE\.md/);
    assert.match(gitignoreBody, /\.claude\/\.vulyk/);
    assert.doesNotMatch(gitignoreBody, /src\/app\/\.vulyk/);
  } finally {
    process.chdir(initialCwd);
  }
});
