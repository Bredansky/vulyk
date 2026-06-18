import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { cleanupStale } from "../src/lib/cleanup.js";
import type { Manifest } from "../src/types.js";

const createdDirs: string[] = [];

function tmpRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-cleanup-"));
  createdDirs.push(dir);
  return dir;
}

function writeFile(filePath: string, body: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body);
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test("cleanupStale: does not remove a group install root (parent of expected install dirs)", () => {
  const projectRoot = tmpRoot();

  // Create the expected install: docs/external/alpha/ with .vulyk marker.
  // The marker at the PARENT (docs/external/.vulyk) simulates the
  // per-group marker that the cleanup walks. Before the fix, the parent
  // was incorrectly removed because it was not in dirInstallDirs — even
  // though it parents an expected install dir.
  writeFile(
    path.join(projectRoot, "docs/external/alpha/doc.md"),
    "# alpha doc\n",
  );
  writeFile(
    path.join(projectRoot, "docs/external/alpha/.vulyk"),
    "🍯 doc.md\n",
  );
  writeFile(
    path.join(projectRoot, "docs/external/.vulyk"),
    "🍯 alpha/.vulyk\n🍯 alpha/doc.md\n",
  );

  const manifest: Manifest = {
    groups: {
      docs: { outputPaths: ["docs/external"] },
    },
    entries: {
      alpha: {
        source: "alpha.md",
        group: "docs",
      },
    },
  };

  cleanupStale(manifest, projectRoot);

  // The expected child MUST survive.
  assert.equal(
    fs.existsSync(path.join(projectRoot, "docs/external/alpha/doc.md")),
    true,
    "expected child install must survive",
  );
  // The group install root MUST also survive.
  assert.equal(
    fs.existsSync(path.join(projectRoot, "docs/external")),
    true,
    "group install root must survive when its children are still expected",
  );
  assert.equal(
    fs.existsSync(path.join(projectRoot, "docs/external/.vulyk")),
    true,
    "group root .vulyk marker must survive",
  );
});

void test("cleanupStale: removes a group install root when ALL child installs are gone", () => {
  const projectRoot = tmpRoot();

  // Group root with marker, but no actual expected children.
  writeFile(
    path.join(projectRoot, "docs/external/.vulyk"),
    "🍯 stale-thing/\n",
  );

  const manifest: Manifest = {
    groups: {
      docs: { outputPaths: ["docs/external"] },
    },
    entries: {},
  };

  cleanupStale(manifest, projectRoot);

  // The empty group root SHOULD be removed.
  assert.equal(
    fs.existsSync(path.join(projectRoot, "docs/external")),
    false,
    "group install root with no expected children must be cleaned up",
  );
});

void test("cleanupStale: still removes truly stale managed dirs (not ancestors of expected installs)", () => {
  const projectRoot = tmpRoot();

  // Two managed dirs: one stale (no expected children), one with expected children.
  writeFile(path.join(projectRoot, "stale-thing/.vulyk"), "🍯 whatever\n");
  writeFile(path.join(projectRoot, "docs/external/alpha/doc.md"), "# alpha\n");
  writeFile(
    path.join(projectRoot, "docs/external/alpha/.vulyk"),
    "🍯 doc.md\n",
  );
  writeFile(
    path.join(projectRoot, "docs/external/.vulyk"),
    "🍯 alpha/.vulyk\n🍯 alpha/doc.md\n",
  );

  const manifest: Manifest = {
    groups: {
      docs: { outputPaths: ["docs/external"] },
    },
    entries: {
      alpha: { source: "alpha.md", group: "docs" },
    },
  };

  cleanupStale(manifest, projectRoot);

  // Stale dir removed.
  assert.equal(
    fs.existsSync(path.join(projectRoot, "stale-thing")),
    false,
    "stale managed dir must be removed",
  );
  // Expected child still present.
  assert.equal(
    fs.existsSync(path.join(projectRoot, "docs/external/alpha/doc.md")),
    true,
    "expected child must survive when stale siblings are removed",
  );
});
