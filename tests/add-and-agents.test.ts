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
import { readState, writeState } from "../src/lib/state.js";
import { writeConfig } from "./fixtures.js";

function makeTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-add-test-"));
}

function writeJson(filePath: string, value: unknown): void {
  writeConfig(filePath, value);
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

function readOwnershipState(projectRoot: string): {
  syncPaths: string[];
  agentPaths: string[];
} {
  return readState(projectRoot);
}

void test("addCommand installs a local skill and writes config inline when no groups are configured", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeJson(path.join(projectRoot, "vulyk.config.ts"), {
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
    path.join(projectRoot, "vulyk.config.ts"),
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

  const manifest = readManifest(path.join(projectRoot, "vulyk.config.ts"));
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

  // Per-dir `.vulyk` markers are gone; ownership is stored in state.json.
  assert.equal(
    fs.existsSync(path.join(projectRoot, ".agents/skills", "alpha", ".vulyk")),
    false,
  );

  // The local ownership state records syncPaths for this install.
  const lock = readOwnershipState(projectRoot);
  assert.ok(
    lock.syncPaths.includes(".agents/skills/alpha"),
    `expected lockfile syncPaths to include .agents/skills/alpha, got ${JSON.stringify(lock.syncPaths)}`,
  );
});

void test("addCommand expands a local collection into per-skill entries with inline config", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeJson(path.join(projectRoot, "vulyk.config.ts"), {
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

  const manifest = readManifest(path.join(projectRoot, "vulyk.config.ts"));
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

  writeJson(path.join(projectRoot, "vulyk.config.ts"), {
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

  const manifest = readManifest(path.join(projectRoot, "vulyk.config.ts"));
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
  const lock = readOwnershipState(projectRoot);
  assert.ok(
    lock.syncPaths.includes("docs/external/guide.md"),
    `expected lockfile syncPaths to include docs/external/guide.md, got ${JSON.stringify(lock.syncPaths)}`,
  );
});

void test("addCommand repoints a named local routed doc and preserves unspecified metadata", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeJson(path.join(projectRoot, "vulyk.config.ts"), {
    groups: {
      docs: {
        agents: ["AGENTS.md"],
      },
    },
    entries: {
      "shadcn-theme": {
        source: "docs/shadcn-theme-guide.md",
        group: "docs",
        targets: ["."],
        scope: ["src/**"],
        description: "Old routing description.",
      },
    },
  });
  writeFile(
    path.join(
      projectRoot,
      "docs",
      "shadcn-theme-guide",
      "shadcn-theme-guide.md",
    ),
    "# shadcn Theme Guide\n",
  );

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    await addCommand("docs/shadcn-theme-guide/shadcn-theme-guide.md", {
      name: "shadcn-theme",
      group: "docs",
      description: "When adapting shadcn components and theme tokens.",
    });
    agentsCommand();
  } finally {
    process.chdir(initialCwd);
  }

  const manifest = readManifest(path.join(projectRoot, "vulyk.config.ts"));
  assert.deepEqual(Object.keys(manifest.entries), ["shadcn-theme"]);
  assert.deepEqual(manifest.entries["shadcn-theme"], {
    source: "docs/shadcn-theme-guide/shadcn-theme-guide.md",
    group: "docs",
    targets: ["."],
    scope: ["src/**"],
    description: "When adapting shadcn components and theme tokens.",
  });
  assert.deepEqual(readOwnershipState(projectRoot).syncPaths, []);

  const agents = fs.readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8");
  assert.match(agents, /When adapting shadcn components and theme tokens\./);
  assert.match(
    agents,
    /Full documentation: docs\/shadcn-theme-guide\/shadcn-theme-guide\.md/,
  );
});

void test("addCommand creates a local routed doc without an output path when targets are provided", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeJson(path.join(projectRoot, "vulyk.config.ts"), {
    groups: { docs: { agents: ["AGENTS.md"] } },
    entries: {},
  });
  writeFile(path.join(projectRoot, "docs", "guide.md"), "# Guide\n");

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    await addCommand("docs/guide.md", {
      name: "guide",
      group: "docs",
      targets: ["src", "tests"],
      description: "When implementing guide-covered behavior.",
    });
  } finally {
    process.chdir(initialCwd);
  }

  const manifest = readManifest(path.join(projectRoot, "vulyk.config.ts"));
  assert.deepEqual(manifest.entries.guide, {
    source: "docs/guide.md",
    group: "docs",
    targets: ["src", "tests"],
    description: "When implementing guide-covered behavior.",
  });
});

void test("addCommand gives an explicit group precedence over source detection", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeJson(path.join(projectRoot, "vulyk.config.ts"), {
    groups: {
      detected: {
        outputPaths: ["detected-docs"],
        validate: { fileExtension: ".md" },
      },
      selected: {
        outputPaths: ["selected-docs"],
      },
    },
    entries: {},
  });
  writeFile(path.join(projectRoot, "sources", "guide.md"), "# Guide\n");

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    await addCommand("sources/guide.md", { group: "selected" });
  } finally {
    process.chdir(initialCwd);
  }

  const manifest = readManifest(path.join(projectRoot, "vulyk.config.ts"));
  assert.equal(manifest.entries.guide?.group, "selected");
  assert.equal(
    fs.existsSync(path.join(projectRoot, "selected-docs", "guide.md")),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(projectRoot, "detected-docs", "guide.md")),
    false,
  );
});

void test("addCommand preserves an inferred existing entry's group", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeJson(path.join(projectRoot, "vulyk.config.ts"), {
    groups: {
      detected: {
        outputPaths: ["detected-docs"],
        validate: { fileExtension: ".md" },
      },
      selected: {
        outputPaths: ["selected-docs"],
      },
    },
    entries: {
      guide: {
        source: "old/guide.md",
        group: "selected",
        description: "Existing guide.",
      },
    },
  });
  writeFile(path.join(projectRoot, "sources", "guide.md"), "# Guide\n");

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    await addCommand("sources/guide.md");
  } finally {
    process.chdir(initialCwd);
  }

  const manifest = readManifest(path.join(projectRoot, "vulyk.config.ts"));
  assert.deepEqual(manifest.entries.guide, {
    source: "sources/guide.md",
    group: "selected",
    description: "Existing guide.",
  });
  assert.equal(
    fs.existsSync(path.join(projectRoot, "selected-docs", "guide.md")),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(projectRoot, "detected-docs", "guide.md")),
    false,
  );
});

void test("addCommand honors an existing group's outputPaths", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeJson(path.join(projectRoot, "vulyk.config.ts"), {
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

  // Both installs land in local ownership state.
  const lock = readOwnershipState(projectRoot);
  assert.ok(lock.syncPaths.includes("managed-skills/alpha"));
  assert.ok(lock.syncPaths.includes(".claude/skills/alpha"));
});

void test("syncCommand: entry-level outputPaths overrides group outputPaths", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeJson(path.join(projectRoot, "vulyk.config.ts"), {
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

  writeJson(path.join(projectRoot, "vulyk.config.ts"), {
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
    path.join(projectRoot, "vulyk.config.ts"),
    "utf8",
  );
  assert.doesNotMatch(manifestBody, /"alpha":/);
});

void test("syncCommand installs local skills from disk and supports update", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeJson(path.join(projectRoot, "vulyk.config.ts"), {
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

void test("syncCommand prunes tracked managed paths whose entry is removed from vulyk.config.ts", async () => {
  // Under the lockfile-driven cleanup model, vulyk only removes paths it
  // previously wrote. To exercise that, we install both entries first so the
  // lockfile records both, then drop one entry from vulyk.config.ts and re-sync.
  // The corresponding managed dir must be deleted; the kept entry must
  // survive verbatim. User-written files in a managed output path are
  // off-limits to cleanup and are covered by a separate test.
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  const manifestPath = path.join(projectRoot, "vulyk.config.ts");
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
    // First sync: both entries installed and recorded in local state.
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

    const lockBeforeDrop = readOwnershipState(projectRoot);
    assert.ok(
      lockBeforeDrop.syncPaths.includes("managed-skills/alpha"),
      `state should track alpha as a directory; got ${JSON.stringify(lockBeforeDrop.syncPaths)}`,
    );
    assert.ok(
      lockBeforeDrop.syncPaths.includes("managed-skills/remote"),
      `state should track remote as a directory; got ${JSON.stringify(lockBeforeDrop.syncPaths)}`,
    );

    // Drop the remote entry from the manifest and re-sync.
    const manifest = readManifest(manifestPath);
    delete manifest.entries.remote;
    fs.writeFileSync(
      manifestPath,
      `export default ${JSON.stringify(manifest, null, 2)};\n`,
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
      "stale generated directory must be pruned",
    );

    const lockAfterDrop = readOwnershipState(projectRoot);
    assert.ok(
      !lockAfterDrop.syncPaths.includes("managed-skills/remote"),
      `state should no longer track remote; got ${JSON.stringify(lockAfterDrop.syncPaths)}`,
    );
    assert.ok(
      lockAfterDrop.syncPaths.includes("managed-skills/alpha"),
      `state should still track alpha; got ${JSON.stringify(lockAfterDrop.syncPaths)}`,
    );
  } finally {
    process.chdir(initialCwd);
  }
});

void test("syncCommand preserves managed files and state when an entry fails", async () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeJson(path.join(projectRoot, "vulyk.config.ts"), {
    entries: {
      broken: {
        source: "not-a-supported-source",
        outputPaths: ["managed-docs"],
      },
    },
  });
  writeFile(
    path.join(projectRoot, "managed-docs", "existing.md"),
    "existing\n",
  );
  writeState(projectRoot, {
    syncPaths: ["managed-docs/existing.md"],
    agentPaths: [],
  });

  const initialCwd = process.cwd();
  process.chdir(projectRoot);
  let succeeded = false;
  try {
    succeeded = await syncCommand();
  } finally {
    process.chdir(initialCwd);
  }

  assert.equal(succeeded, false);
  assert.equal(
    fs.existsSync(path.join(projectRoot, "managed-docs", "existing.md")),
    true,
  );
  assert.deepEqual(readState(projectRoot).syncPaths, [
    "managed-docs/existing.md",
  ]);
});

void test("agentsCommand leaves user-added files in an output path alone", () => {
  const projectRoot = makeTempProject();
  createdDirs.push(projectRoot);

  writeJson(path.join(projectRoot, "vulyk.config.ts"), {
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
    // Agents did not run a sync, so generated sync ownership is absent.
    // Either way, my-notes.md is not recorded.
    if (fs.existsSync(path.join(projectRoot, ".vulyk"))) {
      const lock = readOwnershipState(projectRoot);
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

  writeJson(path.join(projectRoot, "vulyk.config.ts"), {
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
    // Per-dir `.vulyk` is gone; state tracks the install.
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
