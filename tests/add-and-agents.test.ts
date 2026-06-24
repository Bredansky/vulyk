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
import { readState } from "../src/lib/state.js";

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
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function readLockfile(projectRoot: string): {
  syncPaths: string[];
  agentPaths: string[];
} {
  return readState(projectRoot);
}

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
  assert.match(manifestBody, /"groups":\s*\{\s*\}/);
  assert.match(
    manifestBody,
    /"alpha":\s*\{[\s\S]*"source":\s*"sources\/alpha"/,
  );
  assert.match(manifestBody, /"outputPaths":\s*\[[\s\S]*"\.agents\/skills"/);
  assert.match(manifestBody, /"validate":\s*\{[\s\S]*"mustContain"/);
  assert.match(manifestBody, /"gitIgnore":\s*true/);

  const manifest = readManifest(path.join(projectRoot, "vulyk.json"));
  const alpha = manifest.entries.alpha;
  assert.ok(alpha);
  assert.equal(alpha.group, undefined);
  assert.deepEqual(alpha.outputPaths, [".agents/skills"]);
  assert.deepEqual(alpha.validate, { mustContain: ["SKILL.md"] });
  assert.equal(alpha.gitIgnore, true);

  // File installed at the first outputPath.
  assert.equal(
    fs.existsSync(
      path.join(projectRoot, ".agents/skills", "alpha", "SKILL.md"),
    ),
    true,
  );

  // Per-dir `.vulyk` markers are gone — the lockfile alone tracks state.
  assert.equal(
    fs.existsSync(path.join(projectRoot, ".agents/skills", "alpha", ".vulyk")),
    false,
  );

  // The lockfile records syncPaths for this install.
  const lock = readLockfile(projectRoot);
  assert.ok(
    lock.syncPaths.includes(".agents/skills/alpha"),
    `expected lockfile syncPaths to include .agents/skills/alpha, got ${JSON.stringify(lock.syncPaths)}`,
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
    fs.existsSync(path.join(projectRoot, "docs", "external", "guide.md")),
    true,
  );

  // Symmetric to the dir-source tests: the lockfile tracks the file-source
  // install at its destination file path (no suffix magic).
  const lock = readLockfile(projectRoot);
  assert.ok(
    lock.syncPaths.includes("docs/external/guide.md"),
    `expected lockfile syncPaths to include docs/external/guide.md, got ${JSON.stringify(lock.syncPaths)}`,
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
      path.join(projectRoot, ".claude", "skills", "alpha", "SKILL.md"),
    ),
    true,
  );

  // Both installs land in the lockfile.
  const lock = readLockfile(projectRoot);
  assert.ok(lock.syncPaths.includes("managed-skills/alpha"));
  assert.ok(lock.syncPaths.includes(".claude/skills/alpha"));
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

  assert.equal(
    fs.existsSync(
      path.join(projectRoot, ".claude", "skills", "inline-only", "SKILL.md"),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(projectRoot, "managed-skills", "inline-only")),
    false,
  );
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

void test("syncCommand prunes tracked managed paths whose entry is removed from vulyk.json", async () => {
  // Under the lockfile-driven cleanup model, vulyk only removes paths it
  // previously wrote. To exercise that, we install both entries first so the
  // lockfile records both, then drop one entry from vulyk.json and re-sync.
  // The corresponding managed dir must be deleted; the kept entry must
  // survive verbatim. User-written files in a managed output path are
  // off-limits to cleanup and are covered by a separate test.
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  const manifestPath = path.join(projectRoot, "vulyk.json");
  writeJson(manifestPath, {
    groups: {
      skills: {
        outputPaths: ["managed-skills"],
        validate: { mustContain: ["SKILL.md"] },
      },
    },
    entries: {
      alpha: { source: "sources/alpha", group: "skills" },
      remote: { source: "sources/remote", group: "skills" },
    },
  });
  writeFile(
    path.join(projectRoot, "sources", "alpha", "SKILL.md"),
    "---\nname: alpha\n---\n\n# Alpha source\n",
  );
  writeFile(
    path.join(projectRoot, "sources", "remote", "SKILL.md"),
    "---\nname: remote\n---\n\n# Remote source\n",
  );

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    // First sync: both entries installed and recorded in the lockfile.
    await syncCommand();
    const alphaPath = path.join(
      projectRoot,
      "managed-skills",
      "alpha",
      "SKILL.md",
    );
    const remotePath = path.join(
      projectRoot,
      "managed-skills",
      "remote",
      "SKILL.md",
    );
    assert.equal(
      fs.existsSync(alphaPath),
      true,
      "alpha installed on first sync",
    );
    assert.equal(
      fs.existsSync(remotePath),
      true,
      "remote installed on first sync",
    );

    const lockBeforeDrop = readLockfile(projectRoot);
    assert.ok(
      lockBeforeDrop.syncPaths.includes("managed-skills/alpha"),
      `lockfile should track alpha as a directory; got ${JSON.stringify(lockBeforeDrop.syncPaths)}`,
    );
    assert.ok(
      lockBeforeDrop.syncPaths.includes("managed-skills/remote"),
      `lockfile should track remote as a directory; got ${JSON.stringify(lockBeforeDrop.syncPaths)}`,
    );

    // Drop the remote entry from the manifest and re-sync.
    const manifest = readManifest(manifestPath);
    delete manifest.entries.remote;
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}
`,
      "utf8",
    );

    await syncCommand();

    assert.equal(
      fs.existsSync(alphaPath),
      true,
      "kept entry must survive re-sync",
    );
    assert.equal(
      fs.existsSync(path.join(projectRoot, "managed-skills", "remote")),
      false,
      "untracked entry's managed dir must be pruned",
    );

    const lockAfterDrop = readLockfile(projectRoot);
    assert.ok(
      !lockAfterDrop.syncPaths.includes("managed-skills/remote"),
      `lockfile should no longer track remote; got ${JSON.stringify(lockAfterDrop.syncPaths)}`,
    );
    assert.ok(
      lockAfterDrop.syncPaths.includes("managed-skills/alpha"),
      `lockfile should still track alpha; got ${JSON.stringify(lockAfterDrop.syncPaths)}`,
    );
  } finally {
    process.chdir(initialCwd);
  }
});

void test("agentsCommand leaves user-added files in an output path alone", () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

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
    path.join(projectRoot, "docs", "external", "project-structure.md"),
    "# Project Structure\n",
  );
  writeFile(
    path.join(projectRoot, "docs", "external", "my-notes.md"),
    "# My notes\n",
  );

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    agentsCommand();
    assert.equal(
      fs.existsSync(path.join(projectRoot, "docs", "external", "my-notes.md")),
      true,
    );
    // Agents did not run a sync, so .vulyk does NOT exist
    // yet (or it could carry agentPaths). Either way, my-notes.md is
    // not in the lockfile.
    if (fs.existsSync(path.join(projectRoot, ".vulyk"))) {
      const lock = readLockfile(projectRoot);
      assert.ok(!lock.syncPaths.includes("docs/external/my-notes.md"));
      assert.ok(!lock.agentPaths.includes("docs/external/my-notes.md"));
    }
  } finally {
    process.chdir(initialCwd);
  }
});

void test("syncCommand does not gitignore local sources that share a managed output path", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeFile(
    path.join(projectRoot, "package.json"),
    '{"name":"test-fixture"}\n',
  );

  writeJson(path.join(projectRoot, "vulyk.json"), {
    groups: {
      skills: {
        outputPaths: ["skills", "managed-skills"],
        validate: { mustContain: ["SKILL.md"] },
        gitIgnore: true,
      },
    },
    entries: {
      alpha: { source: "skills/alpha", group: "skills" },
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
    // Per-dir `.vulyk` is gone; lockfile tracks the install.
    assert.equal(
      fs.existsSync(
        path.join(projectRoot, "managed-skills", "alpha", ".vulyk"),
      ),
      false,
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
