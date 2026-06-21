import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isEnabled,
  resolveOutputPaths,
  resolveAgents,
  resolveGitignoreGenerated,
  setEnabled,
  entriesByGroup,
} from "../src/lib/groups.js";
import type { Manifest } from "../src/types.js";

function makeManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    groups: {},
    entries: {},
    ...overrides,
  };
}

void test("isEnabled: empty/missing enabled list = all enabled (default)", () => {
  const manifest = makeManifest({
    entries: {
      alpha: { source: "src/alpha" },
      beta: { source: "src/beta" },
    },
  });
  assert.equal(isEnabled(manifest, "alpha"), true);
  assert.equal(isEnabled(manifest, "beta"), true);
});

void test("isEnabled: non-empty enabled list = whitelist (only those enabled)", () => {
  const manifest = makeManifest({
    enabled: ["alpha"],
    entries: {
      alpha: { source: "src/alpha" },
      beta: { source: "src/beta" },
    },
  });
  assert.equal(isEnabled(manifest, "alpha"), true);
  assert.equal(isEnabled(manifest, "beta"), false);
});

void test("isEnabled: disabled list = explicit opt-out, beats enabled", () => {
  const manifest = makeManifest({
    enabled: ["alpha", "beta"],
    disabled: ["alpha"],
    entries: {
      alpha: { source: "src/alpha" },
      beta: { source: "src/beta" },
    },
  });
  assert.equal(isEnabled(manifest, "alpha"), false);
  assert.equal(isEnabled(manifest, "beta"), true);
});

void test("isEnabled: per-group whitelist takes precedence over global", () => {
  const manifest = makeManifest({
    groups: {
      skills: { enabled: ["alpha"] },
    },
    enabled: ["alpha", "beta"],
    entries: {
      alpha: { source: "src/alpha", group: "skills" },
      beta: { source: "src/beta", group: "skills" },
    },
  });
  // Group whitelist is per-group; alpha is in it, beta is not
  assert.equal(isEnabled(manifest, "alpha"), true);
  assert.equal(isEnabled(manifest, "beta"), false);
});

void test("isEnabled: per-group disabled beats per-group enabled", () => {
  const manifest = makeManifest({
    groups: {
      skills: { enabled: ["alpha", "beta"], disabled: ["alpha"] },
    },
    entries: {
      alpha: { source: "src/alpha", group: "skills" },
      beta: { source: "src/beta", group: "skills" },
    },
  });
  assert.equal(isEnabled(manifest, "alpha"), false);
  assert.equal(isEnabled(manifest, "beta"), true);
});

void test("resolveOutputPaths: entry > group > manifest", () => {
  const manifest = makeManifest({
    outputPaths: ["manifest-default"],
    groups: { skills: { outputPaths: ["group-default"] } },
    entries: {
      a: { source: "src/a", group: "skills" },
      b: { source: "src/b", group: "skills" },
      c: { source: "src/c" },
    },
  });
  manifest.entries.a = {
    source: "src/a",
    group: "skills",
    outputPaths: ["entry-a"],
  };
  assert.deepEqual(resolveOutputPaths(manifest, "a"), ["entry-a"]);
  assert.deepEqual(resolveOutputPaths(manifest, "b"), ["group-default"]);
  assert.deepEqual(resolveOutputPaths(manifest, "c"), ["manifest-default"]);
});

void test("resolveAgents: falls back to entry.agents then group.agents then manifest.agents", () => {
  const manifest = makeManifest({
    entries: {
      a: { source: "src/a", agents: ["CLAUDE.md"] },
      b: { source: "src/b" },
      c: { source: "src/c", group: "g1" },
    },
    groups: {
      g1: { agents: ["GROUP.md"] },
    },
    agents: ["MANIFEST.md"],
  });
  assert.deepEqual(resolveAgents(manifest, "a"), ["CLAUDE.md"]);
  assert.deepEqual(resolveAgents(manifest, "b"), ["MANIFEST.md"]);
  assert.deepEqual(resolveAgents(manifest, "c"), ["GROUP.md"]);
});

void test("resolveGitignoreGenerated: entry > group > manifest, undefined if none set", () => {
  const manifest = makeManifest({
    gitIgnore: false,
    groups: { skills: { gitIgnore: true } },
    entries: {
      a: { source: "src/a", group: "skills" },
      b: { source: "src/b", group: "skills" },
      c: { source: "src/c" },
    },
  });
  manifest.entries.a = {
    source: "src/a",
    group: "skills",
    gitIgnore: false,
  };
  assert.equal(resolveGitignoreGenerated(manifest, "a"), false);
  assert.equal(resolveGitignoreGenerated(manifest, "b"), true);
  assert.equal(resolveGitignoreGenerated(manifest, "c"), false); // manifest fallback
  // d has no gitignore anywhere → undefined
  const manifest2 = makeManifest({
    entries: { d: { source: "src/d" } },
  });
  assert.equal(resolveGitignoreGenerated(manifest2, "d"), undefined);
});

void test("setEnabled: true removes from disabled, false adds to disabled", () => {
  const manifest = makeManifest({
    entries: {
      a: { source: "src/a" },
      b: { source: "src/b" },
    },
  });
  setEnabled(manifest, "a", false);
  assert.equal(isEnabled(manifest, "a"), false);
  setEnabled(manifest, "a", true);
  assert.equal(isEnabled(manifest, "a"), true);
  setEnabled(manifest, "b", false);
  assert.equal(isEnabled(manifest, "b"), false);
});

void test("entriesByGroup: groups entries by their group field, ungrouped goes to '_default'", () => {
  const manifest = makeManifest({
    groups: {
      skills: { outputPaths: [".agents/skills"] },
      docs: { outputPaths: ["docs/external"] },
    },
    entries: {
      alpha: { source: "src/alpha", group: "skills" },
      beta: { source: "src/beta", group: "skills" },
      guide: { source: "docs/guide.md", group: "docs" },
      other: { source: "src/other" },
    },
  });
  const grouped = entriesByGroup(manifest);
  assert.deepEqual(
    [...grouped.keys()].sort(),
    ["(ungrouped)", "docs", "skills"].sort(),
  );
  assert.equal(grouped.get("skills")?.length, 2);
  assert.equal(grouped.get("docs")?.length, 1);
  assert.equal(grouped.get("(ungrouped)")?.length, 1);
});
