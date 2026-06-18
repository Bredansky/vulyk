import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { addCommand } from "../src/commands/add.js";
import { removeCommand } from "../src/commands/remove.js";
import { agentsCommand } from "../src/commands/agents.js";
import { readManifest } from "../src/lib/manifest.js";

function makeTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-add-test-"));
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

void test("addCommand installs a local skill and auto-creates a skills group", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeJson(path.join(projectRoot, "vulyk.json"), {
    groups: {},
    entries: {},
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
  assert.match(manifestBody, /"groups":\s*\{[\s\S]*"skills"/);
  assert.match(
    manifestBody,
    /"alpha":\s*\{[\s\S]*"source":\s*"sources\/alpha"/,
  );
  assert.match(manifestBody, /"group":\s*"skills"/);

  assert.equal(
    fs.existsSync(
      path.join(projectRoot, ".agents/skills", "alpha", "SKILL.md"),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(projectRoot, ".agents/skills", "alpha", ".vulyk")),
    true,
  );
});

void test("addCommand expands a local collection into per-skill entries", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeJson(path.join(projectRoot, "vulyk.json"), {
    groups: {},
    entries: {},
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

  const manifest = readManifest(path.join(projectRoot, "vulyk.json"));
  assert.ok(manifest.entries.one);
  assert.ok(manifest.entries.two);
  assert.equal(manifest.entries.one.group, "skills");
  assert.equal(manifest.entries.two.group, "skills");
  assert.equal(
    fs.existsSync(path.join(projectRoot, ".agents/skills", "one", "SKILL.md")),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(projectRoot, ".agents/skills", "two", "SKILL.md")),
    true,
  );
});

void test("addCommand installs a local doc and auto-creates a docs group", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeJson(path.join(projectRoot, "vulyk.json"), {
    groups: {},
    entries: {},
  });
  writeFile(path.join(projectRoot, "docs-source", "guide.md"), "# Guide\n");

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    await addCommand("./docs-source/guide.md", {});
  } finally {
    process.chdir(initialCwd);
  }

  const manifest = readManifest(path.join(projectRoot, "vulyk.json"));
  assert.ok(manifest.entries.guide);
  assert.equal(manifest.entries.guide.group, "docs");
  assert.equal(
    fs.existsSync(path.join(projectRoot, "docs/external/guide.md")),
    true,
  );
});

void test("addCommand honors an existing group's outputPaths", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeJson(path.join(projectRoot, "vulyk.json"), {
    groups: {
      skills: {
        outputPaths: ["managed-skills", ".claude/skills"],
        validate: { mustContain: ["SKILL.md"] },
        gitignoreGenerated: true,
      },
    },
    entries: {},
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

  assert.equal(
    fs.existsSync(
      path.join(projectRoot, "managed-skills", "alpha", "SKILL.md"),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(projectRoot, ".claude/skills", "alpha", "SKILL.md"),
    ),
    true,
  );
});

void test("removeCommand deletes an entry from the manifest", () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeJson(path.join(projectRoot, "vulyk.json"), {
    groups: {
      skills: {
        outputPaths: ["managed-skills"],
        validate: { mustContain: ["SKILL.md"] },
      },
    },
    entries: {
      alpha: { source: "sources/alpha", group: "skills" },
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
    removeCommand("alpha");
  } finally {
    process.chdir(initialCwd);
  }

  const manifestBody = fs.readFileSync(
    path.join(projectRoot, "vulyk.json"),
    "utf8",
  );
  assert.doesNotMatch(manifestBody, /"alpha":/);
});

void test("agentsCommand installs local skills from disk and supports update", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeJson(path.join(projectRoot, "vulyk.json"), {
    groups: {
      skills: {
        outputPaths: ["managed-skills"],
        validate: { mustContain: ["SKILL.md"] },
      },
    },
    entries: {
      alpha: { source: "sources/alpha", group: "skills" },
    },
  });
  writeFile(
    path.join(projectRoot, "sources", "alpha", "SKILL.md"),
    "---\nname: alpha\n---\n\n# Alpha v1\n",
  );

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    await agentsCommand();
    const installedPath = path.join(
      projectRoot,
      "managed-skills",
      "alpha",
      "SKILL.md",
    );
    assert.match(fs.readFileSync(installedPath, "utf8"), /Alpha v1/);

    writeFile(
      path.join(projectRoot, "sources", "alpha", "SKILL.md"),
      "---\nname: alpha\n---\n\n# Alpha v2\n",
    );

    await agentsCommand();
    assert.match(fs.readFileSync(installedPath, "utf8"), /Alpha v2/);
  } finally {
    process.chdir(initialCwd);
  }
});

void test("agentsCommand prunes stale managed skill dirs not in any entry's output paths", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeJson(path.join(projectRoot, "vulyk.json"), {
    groups: {
      skills: {
        outputPaths: ["managed-skills"],
        validate: { mustContain: ["SKILL.md"] },
      },
    },
    entries: {
      alpha: { source: "sources/alpha", group: "skills" },
    },
  });
  writeFile(
    path.join(projectRoot, "sources", "alpha", "SKILL.md"),
    "---\nname: alpha\n---\n\n# Alpha source\n",
  );
  writeFile(
    path.join(projectRoot, "managed-skills", "remote-one", "SKILL.md"),
    "---\nname: remote-one\n---\n\n# Remote one\n",
  );
  writeFile(
    path.join(projectRoot, "managed-skills", "remote-one", ".vulyk"),
    "🍯\n",
  );
  writeFile(
    path.join(projectRoot, "managed-skills", "remote-two", "SKILL.md"),
    "---\nname: remote-two\n---\n\n# Remote two\n",
  );
  writeFile(
    path.join(projectRoot, "managed-skills", "remote-two", ".vulyk"),
    "🍯\n",
  );

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    await agentsCommand();

    assert.equal(
      fs.existsSync(path.join(projectRoot, "managed-skills", "alpha")),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(projectRoot, "managed-skills", "remote-one")),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(projectRoot, "managed-skills", "remote-two")),
      false,
    );
  } finally {
    process.chdir(initialCwd);
  }
});

void test("agentsCommand prunes stale external doc files in shared output paths", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  // Two doc entries that share the docs/external output path, with
  // a previously installed .vulyk manifest listing both. After one
  // entry is removed from the manifest, agentsCommand should remove
  // the corresponding file from the output path (because it's still
  // in the manifest but no longer claimed by any active entry).
  writeFile(
    path.join(projectRoot, "package.json"),
    '{"name":"test-fixture"}\n',
  );
  writeJson(path.join(projectRoot, "vulyk.json"), {
    groups: {
      docs: {
        outputPaths: ["docs/external"],
        validate: { fileExtension: ".md" },
      },
    },
    entries: {
      "project-structure": {
        source: "docs/external/project-structure.md",
        group: "docs",
        targets: ["src"],
        description: "Local structure guidance.",
      },
    },
  });
  writeFile(
    path.join(projectRoot, "docs/external/project-structure.md"),
    "# Project Structure\n",
  );
  writeFile(
    path.join(projectRoot, "docs/external/claude-statusline.md"),
    "# Statusline\n",
  );
  writeFile(path.join(projectRoot, "src/index.ts"), "export {};\n");
  // Pre-populate the .vulyk manifest to simulate a previous install
  // that wrote both files (the new install will refresh it).
  writeFile(
    path.join(projectRoot, "docs/external/.vulyk"),
    "🍯 project-structure.md\n🍯 claude-statusline.md\n",
  );

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    await agentsCommand();
    // The active entry's file is preserved
    assert.equal(
      fs.existsSync(
        path.join(projectRoot, "docs/external/project-structure.md"),
      ),
      true,
    );
    // The stale file (listed in manifest but no longer claimed) is removed
    assert.equal(
      fs.existsSync(
        path.join(projectRoot, "docs/external/claude-statusline.md"),
      ),
      false,
    );
  } finally {
    process.chdir(initialCwd);
  }
});

void test("agentsCommand leaves user-added files in an output path alone", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  // A user-created file in the output path that vulyk never installed
  // should be left alone (the .vulyk manifest is the source of truth).
  writeFile(
    path.join(projectRoot, "package.json"),
    '{"name":"test-fixture"}\n',
  );
  writeJson(path.join(projectRoot, "vulyk.json"), {
    groups: {
      docs: {
        outputPaths: ["docs/external"],
        validate: { fileExtension: ".md" },
      },
    },
    entries: {
      "project-structure": {
        source: "docs/external/project-structure.md",
        group: "docs",
        targets: ["src"],
        description: "Local structure guidance.",
      },
    },
  });
  writeFile(
    path.join(projectRoot, "docs/external/project-structure.md"),
    "# Project Structure\n",
  );
  writeFile(
    path.join(projectRoot, "docs/external/my-notes.md"),
    "# My notes\n",
  );

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    await agentsCommand();
    assert.equal(
      fs.existsSync(path.join(projectRoot, "docs/external/my-notes.md")),
      true,
    );
  } finally {
    process.chdir(initialCwd);
  }
});

void test("agentsCommand does not gitignore local sources that share a managed output path", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  // addRootAnchor: create a package.json so findRoot() stops here
  // instead of walking up to the user's real project.
  writeFile(
    path.join(projectRoot, "package.json"),
    '{"name":"test-fixture"}\n',
  );

  writeJson(path.join(projectRoot, "vulyk.json"), {
    groups: {
      skills: {
        outputPaths: ["skills", "managed-skills"],
        validate: { mustContain: ["SKILL.md"] },
        // No gitignoreGenerated here — defaults apply per source:
        // local source path is left alone, remote copy is gitignored.
      },
    },
    entries: {
      alpha: { source: "skills/alpha", group: "skills" },
    },
  });
  writeFile(
    path.join(projectRoot, "skills/alpha/SKILL.md"),
    "---\nname: alpha\n---\n\n# Alpha source\n",
  );

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    await agentsCommand();

    // Local source preserved
    assert.equal(
      fs.readFileSync(path.join(projectRoot, "skills/alpha/SKILL.md"), "utf8"),
      "---\nname: alpha\n---\n\n# Alpha source\n",
    );
    assert.equal(
      fs.existsSync(path.join(projectRoot, "skills/alpha/.vulyk")),
      false,
    );

    // Managed copy installed
    assert.equal(
      fs.existsSync(path.join(projectRoot, "managed-skills/alpha/SKILL.md")),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(projectRoot, "managed-skills/alpha/.vulyk")),
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
