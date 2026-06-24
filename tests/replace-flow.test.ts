import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { applyCleanupDelta, readState, writeState } from "../src/lib/state.js";

// Replace-entries flow at the lockfile-state level. Exercises what sync.ts / agents.ts
// do internally (applyCleanupDelta + writeState roundtrip) without depending on remote
// registry / source downloads. Pure state-machine coverage.

void test("replace-flow: removing alpha + adding beta cleans stale files, updates .vulyk, preserves agentPaths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-rf-state-"));
  try {
    // Setup: alpha on disk + in .vulyk.
    fs.mkdirSync(path.join(root, "docs/test/alpha"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "docs/test/alpha/file.md"),
      "# ALPHA\n",
      "utf8",
    );
    writeState(root, {
      syncPaths: ["docs/test/alpha/file.md"],
      agentPaths: ["AGENTS.md", "CLAUDE.md"],
    });

    // Verify initial state pinned.
    {
      const st = readState(root);
      assert.ok(
        st.syncPaths.includes("docs/test/alpha/file.md"),
        "alpha recorded in .vulyk",
      );
      assert.ok(
        fs.existsSync(path.join(root, "docs/test/alpha/file.md")),
        "alpha on disk",
      );
    }

    // Simulate "manifest removes alpha, adds beta" — the two halves of replace-flow:
    //   1) applyCleanupDelta(prev, curr-now-empty) removes old alpha from disk.
    //   2) writeState(curr-with-beta) writes the new state to .vulyk.
    applyCleanupDelta(root, ["docs/test/alpha/file.md"], []);
    fs.mkdirSync(path.join(root, "docs/test/beta"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "docs/test/beta/file.md"),
      "# BETA\n",
      "utf8",
    );
    writeState(root, {
      syncPaths: ["docs/test/beta/file.md"],
      agentPaths: ["AGENTS.md", "CLAUDE.md"],
    });

    // Post-state assertions.
    assert.ok(
      !fs.existsSync(path.join(root, "docs/test/alpha/file.md")),
      "alpha removed from disk",
    );
    assert.ok(
      fs.existsSync(path.join(root, "docs/test/beta/file.md")),
      "beta on disk",
    );

    const st = readState(root);
    assert.deepEqual(
      st.syncPaths,
      ["docs/test/beta/file.md"],
      ".vulyk.syncPaths reflects replacement",
    );
    assert.deepEqual(
      st.agentPaths,
      ["AGENTS.md", "CLAUDE.md"],
      ".vulyk.agentPaths preserved (not touched by sync)",
    );

    // .vulyk file exists and is well-formed.
    const text = fs.readFileSync(path.join(root, ".vulyk"), "utf8");
    assert.ok(
      text.includes("\u{1F41D} docs/test/beta/file.md"),
      ".vulyk has \ud83d\udc1d line for beta",
    );
    assert.ok(!text.includes("alpha"), ".vulyk has no alpha reference");
    assert.ok(
      text.includes("\u{1F36F} AGENTS.md"),
      ".vulyk preserves \ud83c\udf6f AGENTS.md",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

void test("applyCleanupDelta refuses stale paths that resolve outside project root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-bounds-state-"));
  try {
    // Plant a legitimate file so cleanup-checks have something real to delete alongside.
    fs.mkdirSync(path.join(root, "docs/test/alpha"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "docs/test/alpha/file.md"),
      "# ALPHA\n",
      "utf8",
    );

    // Inject a path-traversal entry into .vulyk (poison -> simulates attacker or copy-paste corruption).
    writeState(root, {
      syncPaths: [
        "docs/test/alpha/file.md",
        "../../etc/passwd-shaped-relative",
      ],
      agentPaths: [],
    });

    // Cleanup: both entries become stale (curr is empty).
    // applyCleanupDelta must:
    //   - delete the legitimate alpha file (refuses NO traversal; this one's "in")
    //   - silently refuse the traversal entry
    //   - not throw
    assert.doesNotThrow(() => {
      applyCleanupDelta(
        root,
        ["docs/test/alpha/file.md", "../../etc/passwd-shaped-relative"],
        [],
      );
    }, "applyCleanupDelta must not throw on path-traversal");

    assert.ok(
      !fs.existsSync(path.join(root, "docs/test/alpha/file.md")),
      "legitimate alpha removed",
    );

    // Final writeState with empty entries clears .vulyk cleanly;
    // the traversal entry must NEVER re-emerge.
    writeState(root, { syncPaths: [], agentPaths: [] });
    const text = fs.readFileSync(path.join(root, ".vulyk"), "utf8");
    assert.ok(
      !text.includes("../../etc/passwd-shaped-relative"),
      "traversal entry never re-emitted",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

void test("empty-manifest after populated run: writeState({sync:[], agent:[]}) roundtrips to empty .vulyk", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-empty-state-"));
  try {
    fs.mkdirSync(path.join(root, "docs/test/gamma"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "docs/test/gamma/file.md"),
      "# GAMMA\n",
      "utf8",
    );
    writeState(root, {
      syncPaths: ["docs/test/gamma/file.md"],
      agentPaths: ["AGENTS.md"],
    });
    assert.ok(
      readState(root).syncPaths.includes("docs/test/gamma/file.md"),
      "gamma initially recorded",
    );

    // The "remove gamma" replacement: cleanup, then write empty state.
    applyCleanupDelta(root, ["docs/test/gamma/file.md"], []);
    writeState(root, { syncPaths: [], agentPaths: [] });

    assert.ok(
      !fs.existsSync(path.join(root, "docs/test/gamma/file.md")),
      "gamma file removed",
    );
    const after = readState(root);
    assert.deepEqual(after.syncPaths, [], "empty after removal");
    assert.deepEqual(after.agentPaths, [], "agentPaths empty after removal");
    const text = fs.readFileSync(path.join(root, ".vulyk"), "utf8");
    assert.ok(
      text === "" || text === "\n",
      ".vulyk empty after writeState({sync:[], agent:[]})",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

void test("writeState preserves sort-within-kind + agents-first-then-docs ordering across replays", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-rf-order-"));
  try {
    // Write the same state multiple times; ordering should be stable + sorted within kind.
    for (let i = 0; i < 3; i++) {
      writeState(root, {
        syncPaths: ["z.md", "a.md", "m.md"],
        agentPaths: ["ZZ.md", "AA.md", "MM.md"],
      });
    }
    const text = fs.readFileSync(path.join(root, ".vulyk"), "utf8");
    const agentLines = text
      .split("\n")
      .filter(
        (ln) => ln.startsWith("\u{1F36F} ") && ln.length > "\u{1F36F} ".length,
      );
    const docLines = text
      .split("\n")
      .filter(
        (ln) => ln.startsWith("\u{1F41D} ") && ln.length > "\u{1F41D} ".length,
      );
    assert.deepEqual(
      agentLines,
      ["\u{1F36F} AA.md", "\u{1F36F} MM.md", "\u{1F36F} ZZ.md"],
      "agent lines sorted alphabetically within kind",
    );
    assert.deepEqual(
      docLines,
      ["\u{1F41D} a.md", "\u{1F41D} m.md", "\u{1F41D} z.md"],
      "doc lines sorted alphabetically within kind",
    );
    // And agents block precedes the docs block.
    const firstAgentIdx = text.indexOf("\u{1F36F} ");
    const firstDocIdx = text.indexOf("\u{1F41D} ");
    assert.ok(
      firstAgentIdx >= 0 && firstDocIdx > firstAgentIdx,
      "agents-first, docs-second ordering holds after multiple replays",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
