import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { addCommand } from "../src/commands/add.js";
import { removeCommand } from "../src/commands/remove.js";
import { agentsCommand } from "../src/commands/agents.js";
import { syncCommand } from "../src/commands/sync.js";
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

void test("addCommand installs a local skill and writes config inline when no groups are configured", async () => {
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
  // No `groups` block should be auto-created.
  assert.match(manifestBody, /"groups":\s*\{\s*\}/);
  // Entry carries its config inline.
  assert.match(
    manifestBody,
    /"alpha":\s*\{[\s\S]*"source":\s*"sources\/alpha"/,
  );
  assert.match(manifestBody, /"outputPaths":\s*\[[\s\S]*"\.agents\/skills"/);
  assert.match(manifestBody, /"validate":\s*\{[\s\S]*"mustContain"/);
  assert.match(manifestBody, /"gitIgnore":\s*true/);

  // The entry has no `group` reference; the inline config stands on its own.
  const manifest = readManifest(path.join(projectRoot, "vulyk.json"));
  const alpha = manifest.entries.alpha;
  assert.ok(alpha);
  assert.equal(alpha.group, undefined);
  assert.deepEqual(alpha.outputPaths, [".agents/skills"]);
  assert.deepEqual(alpha.validate, { mustContain: ["SKILL.md"] });
  assert.equal(alpha.gitIgnore, true);

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

void test("addCommand expands a local collection into per-skill entries with inline config", async () => {
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
  // No shared group — each entry is self-grouped with inline defaults.
  assert.equal(manifest.entries.one.group, undefined);
  assert.equal(manifest.entries.two.group, undefined);
  assert.deepEqual(manifest.entries.one.outputPaths, [".agents/skills"]);
  assert.deepEqual(manifest.entries.two.outputPaths, [".agents/skills"]);
  assert.equal(
    fs.existsSync(path.join(projectRoot, ".agents/skills", "one", "SKILL.md")),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(projectRoot, ".agents/skills", "two", "SKILL.md")),
    true,
  );
});

void test("addCommand installs a local doc and writes config inline when no groups are configured", async () => {
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
  assert.equal(manifest.entries.guide.group, undefined);
  assert.deepEqual(manifest.entries.guide.outputPaths, ["docs/external"]);
  assert.deepEqual(manifest.entries.guide.validate, { fileExtension: ".md" });
  assert.equal(manifest.entries.guide.gitIgnore, true);
  assert.equal(
    fs.existsSync(path.join(projectRoot, "docs/external", "guide.md")),
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
        gitIgnore: true,
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

void test("syncCommand: entry-level outputPaths overrides group outputPaths", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeJson(path.join(projectRoot, "vulyk.json"), {
    groups: {
      skills: {
        outputPaths: ["managed-skills"],
        validate: { mustContain: ["SKILL.md"] },
        gitIgnore: true,
      },
    },
    entries: {
      "inline-only": {
        source: "sources/inline-only",
        group: "skills",
        // Per-entry override — beats the group's ["managed-skills"].
        outputPaths: [".claude/skills"],
        gitIgnore: false,
      },
    },
  });
  writeFile(
    path.join(projectRoot, "sources", "inline-only", "SKILL.md"),
    "---\nname: inline-only\n---\n\n# Inline Only\n",
  );

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    await syncCommand();
  } finally {
    process.chdir(initialCwd);
  }

  // Group outputPaths ignored; entry's own used.
  assert.equal(
    fs.existsSync(
      path.join(projectRoot, ".claude/skills", "inline-only", "SKILL.md"),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(projectRoot, "managed-skills", "inline-only")),
    false,
  );
  // Per-entry gitignore=false means the file is NOT added to .gitignore
  // even though the group says true.
  if (fs.existsSync(path.join(projectRoot, ".gitignore"))) {
    const gitignore = fs.readFileSync(
      path.join(projectRoot, ".gitignore"),
      "utf8",
    );
    assert.doesNotMatch(gitignore, /^\.claude\/skills\/inline-only\//m);
  }
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

void test("syncCommand installs local skills from disk and supports update", async () => {
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
    await syncCommand();
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

    await syncCommand();
    assert.match(fs.readFileSync(installedPath, "utf8"), /Alpha v2/);
  } finally {
    process.chdir(initialCwd);
  }
});

void test("syncCommand prunes stale managed skill dirs not in any entry's output paths", async () => {
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
    await syncCommand();

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

void test("syncCommand prunes stale external doc files in shared output paths", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  // Two doc entries that share the docs/external output path, with
  // a previously installed .vulyk manifest listing both. After one
  // entry is removed from the manifest, syncCommand should remove
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
    await syncCommand();
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

void test("agentsCommand leaves user-added files in an output path alone", () => {
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
    agentsCommand();
    assert.equal(
      fs.existsSync(path.join(projectRoot, "docs/external/my-notes.md")),
      true,
    );
  } finally {
    process.chdir(initialCwd);
  }
});

void test("syncCommand does not gitignore local sources that share a managed output path", async () => {
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
        // Explicit opt-in to gitignore. Local source at the same path
        // is excluded via the srcSameAsDest heuristic; the remote-style
        // copy at managed-skills/alpha/ is gitignored.
        gitIgnore: true,
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
    await syncCommand();

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
