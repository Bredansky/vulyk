import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { addCommand } from "../src/commands/add.js";
import { syncCommand } from "../src/commands/sync.js";
import { updateCommand } from "../src/commands/update.js";
import {
  skillOutputAddCommand,
  skillOutputRemoveCommand,
} from "../src/commands/skill-output.js";

function makeTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-skills-test-"));
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

void test("addCommand installs a local skill and stores a relative source path", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeJson(path.join(projectRoot, "vulyk.json"), {
    skills: {
      outputPaths: ["managed-skills"],
      entries: {},
    },
  });
  writeFile(
    path.join(projectRoot, "sources", "alpha", "SKILL.md"),
    "---\nname: alpha\n---\n\n# Alpha\n",
  );

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    await addCommand("./sources/alpha", {});
  } finally {
    process.chdir(initialCwd);
  }

  const manifestBody = fs.readFileSync(
    path.join(projectRoot, "vulyk.json"),
    "utf8",
  );
  assert.match(manifestBody, /"alpha":\s*\{\s*"source": "sources\/alpha"/);
  assert.equal(
    fs.existsSync(
      path.join(projectRoot, "managed-skills", "alpha", "SKILL.md"),
    ),
    true,
  );
});

void test("addCommand expands a local collection into per-skill sources", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeJson(path.join(projectRoot, "vulyk.json"), {
    skills: {
      outputPaths: ["managed-skills"],
      entries: {},
    },
  });
  writeFile(
    path.join(projectRoot, "sources", "pack", "one", "SKILL.md"),
    "---\nname: one\n---\n\n# One\n",
  );
  writeFile(
    path.join(projectRoot, "sources", "pack", "two", "SKILL.md"),
    "---\nname: two\n---\n\n# Two\n",
  );

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    await addCommand("./sources/pack", {});
  } finally {
    process.chdir(initialCwd);
  }

  const manifestBody = fs.readFileSync(
    path.join(projectRoot, "vulyk.json"),
    "utf8",
  );
  assert.match(manifestBody, /"one":\s*\{\s*"source": "sources\/pack\/one"/);
  assert.match(manifestBody, /"two":\s*\{\s*"source": "sources\/pack\/two"/);
  assert.equal(
    fs.existsSync(path.join(projectRoot, "managed-skills", "one", "SKILL.md")),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(projectRoot, "managed-skills", "two", "SKILL.md")),
    true,
  );
});

void test("syncCommand and updateCommand install local skills directly from disk", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeJson(path.join(projectRoot, "vulyk.json"), {
    skills: {
      outputPaths: ["managed-skills"],
      entries: {
        alpha: {
          source: "sources/alpha",
        },
      },
    },
  });
  writeFile(
    path.join(projectRoot, "sources", "alpha", "SKILL.md"),
    "---\nname: alpha\n---\n\n# Alpha v1\n",
  );

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    await syncCommand();
    const installedSkillPath = path.join(
      projectRoot,
      "managed-skills",
      "alpha",
      "SKILL.md",
    );
    assert.match(fs.readFileSync(installedSkillPath, "utf8"), /Alpha v1/);

    writeFile(
      path.join(projectRoot, "sources", "alpha", "SKILL.md"),
      "---\nname: alpha\n---\n\n# Alpha v2\n",
    );

    await updateCommand("alpha");
    assert.match(fs.readFileSync(installedSkillPath, "utf8"), /Alpha v2/);
  } finally {
    process.chdir(initialCwd);
  }
});

void test("local skill sources can share a codex-style output root without being overwritten or gitignored", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeJson(path.join(projectRoot, "vulyk.json"), {
    skills: {
      outputPaths: ["skills", "managed-skills"],
      entries: {
        alpha: {
          source: "skills/alpha",
        },
      },
    },
  });
  writeFile(
    path.join(projectRoot, "skills", "alpha", "SKILL.md"),
    "---\nname: alpha\n---\n\n# Alpha source\n",
  );

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    await syncCommand();

    assert.equal(
      fs.readFileSync(
        path.join(projectRoot, "skills", "alpha", "SKILL.md"),
        "utf8",
      ),
      "---\nname: alpha\n---\n\n# Alpha source\n",
    );
    assert.equal(
      fs.existsSync(path.join(projectRoot, "skills", "alpha", ".vulyk")),
      false,
    );
    assert.equal(
      fs.existsSync(
        path.join(projectRoot, "managed-skills", "alpha", "SKILL.md"),
      ),
      true,
    );
    assert.equal(
      fs.existsSync(
        path.join(projectRoot, "managed-skills", "alpha", ".vulyk"),
      ),
      true,
    );

    const gitignoreBody = fs.readFileSync(
      path.join(projectRoot, ".gitignore"),
      "utf8",
    );
    assert.doesNotMatch(gitignoreBody, /^skills\/alpha\/$/m);
    assert.match(gitignoreBody, /^managed-skills\/alpha\/$/m);
  } finally {
    process.chdir(initialCwd);
  }
});

void test("skill output commands manage outputPaths in the manifest", () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeJson(path.join(projectRoot, "vulyk.json"), {
    skills: {
      outputPaths: [".claude/skills"],
    },
  });

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    skillOutputAddCommand("skills/");
    skillOutputAddCommand(".claude/skills");
    skillOutputRemoveCommand(".claude/skills");

    const manifestBody = fs.readFileSync(
      path.join(projectRoot, "vulyk.json"),
      "utf8",
    );
    assert.match(manifestBody, /"outputPaths": \[\s*"skills"\s*\]/);
    assert.doesNotMatch(manifestBody, /\.claude\/skills/);
  } finally {
    process.chdir(initialCwd);
  }
});

void test("syncCommand prunes stale managed remote skills from removed output paths", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeJson(path.join(projectRoot, "vulyk.json"), {
    skills: {
      outputPaths: [".claude/skills", ".codex/skills"],
      entries: {
        alpha: {
          source: "sources/alpha",
        },
      },
    },
  });
  writeFile(
    path.join(projectRoot, "sources", "alpha", "SKILL.md"),
    "---\nname: alpha\n---\n\n# Alpha source\n",
  );
  writeFile(
    path.join(projectRoot, "skills", "remote-one", "SKILL.md"),
    "---\nname: remote-one\n---\n\n# Remote one\n",
  );
  writeFile(path.join(projectRoot, "skills", "remote-one", ".vulyk"), "🍯\n");
  writeFile(
    path.join(projectRoot, "skills", "remote-two", "SKILL.md"),
    "---\nname: remote-two\n---\n\n# Remote two\n",
  );
  writeFile(path.join(projectRoot, "skills", "remote-two", ".vulyk"), "🍯\n");
  writeFile(
    path.join(projectRoot, ".gitignore"),
    "# managed by vulyk\nskills/remote-one/\nskills/remote-two/\n# end vulyk\n",
  );

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    await syncCommand();

    assert.equal(
      fs.existsSync(path.join(projectRoot, "skills", "remote-one")),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(projectRoot, "skills", "remote-two")),
      false,
    );

    const gitignoreBody = fs.readFileSync(
      path.join(projectRoot, ".gitignore"),
      "utf8",
    );
    assert.doesNotMatch(gitignoreBody, /^skills\/remote-one\/$/m);
    assert.doesNotMatch(gitignoreBody, /^skills\/remote-two\/$/m);
  } finally {
    process.chdir(initialCwd);
  }
});
