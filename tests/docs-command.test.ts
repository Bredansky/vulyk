import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { docsCommand } from "../src/commands/docs.js";

function makeTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-docs-test-"));
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeFile(filePath: string, body: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body, "utf8");
}

function exists(filePath: string): boolean {
  return fs.existsSync(filePath);
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

void test("docsCommand prunes stale generated files when a target bucket disappears", () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeFile(path.join(projectRoot, "docs", "skills.md"), "# Skills\n");
  fs.mkdirSync(path.join(projectRoot, ".claude", "skills"), {
    recursive: true,
  });
  writeJson(path.join(projectRoot, "vulyk.json"), {
    docs: {
      rules: {
        claude: {
          match: [".claude/**"],
          also: ["CLAUDE.md"],
        },
      },
      entries: {
        skills: {
          source: "docs/skills.md",
          targets: [".claude/skills"],
          description: "Skills guidance.",
          gitignoreGenerated: false,
        },
      },
    },
  });

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    docsCommand({});
    assert.equal(
      exists(path.join(projectRoot, ".claude", "skills", "AGENTS.md")),
      true,
    );
    assert.equal(
      exists(path.join(projectRoot, ".claude", "skills", "CLAUDE.md")),
      true,
    );

    writeJson(path.join(projectRoot, "vulyk.json"), {
      docs: {
        rules: {
          claude: {
            match: [".claude/**"],
            also: ["CLAUDE.md"],
          },
        },
        entries: {},
      },
    });

    docsCommand({});

    assert.equal(
      exists(path.join(projectRoot, ".claude", "skills", "AGENTS.md")),
      false,
    );
    assert.equal(
      exists(path.join(projectRoot, ".claude", "skills", "CLAUDE.md")),
      false,
    );
  } finally {
    process.chdir(initialCwd);
  }
});

void test("docsCommand keeps a bucket alive when another entry still targets it", () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeFile(path.join(projectRoot, "docs", "one.md"), "# One\n");
  writeFile(path.join(projectRoot, "docs", "two.md"), "# Two\n");
  writeFile(path.join(projectRoot, ".claude", "skills", "example.txt"), "x");

  writeJson(path.join(projectRoot, "vulyk.json"), {
    docs: {
      rules: {
        claude: {
          match: [".claude/**"],
          also: ["CLAUDE.md"],
        },
      },
      entries: {
        first: {
          source: "docs/one.md",
          targets: [".claude/skills"],
          description: "First doc.",
          gitignoreGenerated: false,
        },
        second: {
          source: "docs/two.md",
          targets: [".claude/skills/example.txt"],
          description: "Second doc.",
          gitignoreGenerated: false,
        },
      },
    },
  });

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    docsCommand({});
    const agentsPath = path.join(projectRoot, ".claude", "skills", "AGENTS.md");
    assert.equal(exists(agentsPath), true);
    assert.match(fs.readFileSync(agentsPath, "utf8"), /# One/);
    assert.match(fs.readFileSync(agentsPath, "utf8"), /# Two/);

    writeJson(path.join(projectRoot, "vulyk.json"), {
      docs: {
        rules: {
          claude: {
            match: [".claude/**"],
            also: ["CLAUDE.md"],
          },
        },
        entries: {
          second: {
            source: "docs/two.md",
            targets: [".claude/skills/example.txt"],
            description: "Second doc.",
            gitignoreGenerated: false,
          },
        },
      },
    });

    docsCommand({});

    assert.equal(exists(agentsPath), true);
    const body = fs.readFileSync(agentsPath, "utf8");
    assert.match(body, /# Two/);
    assert.doesNotMatch(body, /# One/);
  } finally {
    process.chdir(initialCwd);
  }
});

void test("docsCommand gitignores generated doc marker files for active buckets", () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeFile(path.join(projectRoot, "docs", "root.md"), "# Root\n");
  writeFile(path.join(projectRoot, "docs", "claude.md"), "# Claude\n");
  fs.mkdirSync(path.join(projectRoot, ".claude"), {
    recursive: true,
  });

  writeJson(path.join(projectRoot, "vulyk.json"), {
    docs: {
      rules: {
        claude: {
          match: [".claude/**"],
          also: ["CLAUDE.md"],
        },
      },
      entries: {
        root: {
          source: "docs/root.md",
          targets: ["README.md"],
          description: "Root doc.",
        },
        claude: {
          source: "docs/claude.md",
          targets: [".claude/settings.json"],
          description: "Claude doc.",
        },
      },
    },
  });

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    docsCommand({});

    const gitignoreBody = fs.readFileSync(
      path.join(projectRoot, ".gitignore"),
      "utf8",
    );
    assert.match(gitignoreBody, /^# managed by vulyk/m);
    assert.match(gitignoreBody, /^\*\*\/\.vulyk$/m);
    assert.doesNotMatch(gitignoreBody, /^\.vulyk$/m);
    assert.doesNotMatch(gitignoreBody, /^\.claude\/\.vulyk$/m);
  } finally {
    process.chdir(initialCwd);
  }
});
