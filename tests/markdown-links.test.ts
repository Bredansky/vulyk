import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { resolveMarkdownLinks } from "../src/lib/markdown-links.js";
import { getRepoCachePath } from "../src/lib/cache.js";
import type { LinkResolution } from "../src/types.js";
import type { VulykLockfile } from "../src/lib/lockfile.js";

interface TestRepository {
  root: string;
  commit: string;
}

function makeRepository(files: Record<string, string>): TestRepository {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-links-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: root,
  });
  execFileSync("git", ["config", "user.name", "Vulyk Test"], { cwd: root });
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", "docs"], { cwd: root });
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  return { root, commit };
}

function seedGitHubCache(
  owner: string,
  repo: string,
  repository: TestRepository,
): void {
  const repoUrl = `https://github.com/${owner}/${repo}.git`;
  const cachePath = getRepoCachePath(repoUrl);
  fs.rmSync(cachePath, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  execFileSync("git", ["clone", "-q", "--bare", repository.root, cachePath]);
}

function makeFixtures(): {
  repository: TestRepository;
  otherRepository: TestRepository;
} {
  const repository = makeRepository({
    "docs/guide.md":
      "See [Architecture](./architecture.md#layers).\nSee [Remote](https://github.com/example/other/blob/main/README.md#intro).\nSee [React](https://react.dev/learn).\n",
    "docs/architecture.md": "# Layers\n",
  });
  const otherRepository = makeRepository({ "README.md": "# Other\n" });
  seedGitHubCache("example", "docs", repository);
  seedGitHubCache("example", "other", otherRepository);
  return { repository, otherRepository };
}

function config(): LinkResolution {
  return {
    sharedOutputPath: "docs/shared",
    sharedSourceRoot: "docs",
    maxDepth: 1,
  };
}

void test("resolveMarkdownLinks rewrites relative Markdown links and preserves fragments", () => {
  const { repository } = makeFixtures();
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-consumer-"));
  const installedPath = path.join(projectRoot, "docs", "external", "guide.md");
  const lockfile: VulykLockfile = { github: {} };
  const source = `https://github.com/example/docs/blob/${repository.commit}/docs/guide.md`;

  const result = resolveMarkdownLinks(
    fs.readFileSync(path.join(repository.root, "docs", "guide.md"), "utf8"),
    source,
    installedPath,
    projectRoot,
    config(),
    lockfile,
    0,
  );

  assert.match(result.markdown, /\.\.\/shared\/architecture\.md#layers/);
  assert.ok(
    result.managedPaths.some((managedPath) =>
      managedPath.endsWith(path.join("docs", "shared", "architecture.md")),
    ),
  );
  assert.match(
    result.markdown,
    /https:\/\/github\.com\/example\/other\/blob\/[0-9a-f]{40}\/README\.md#intro/,
  );
  assert.match(result.markdown, /https:\/\/react\.dev\/learn/);
});

void test("resolveMarkdownLinks pins absolute GitHub refs and records the resolution", () => {
  const { repository, otherRepository } = makeFixtures();
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vulyk-consumer-"));
  const installedPath = path.join(projectRoot, "docs", "external", "guide.md");
  const lockfile: VulykLockfile = { github: {} };
  const source = `https://github.com/example/docs/blob/${repository.commit}/docs/guide.md`;

  const result = resolveMarkdownLinks(
    fs.readFileSync(path.join(repository.root, "docs", "guide.md"), "utf8"),
    source,
    installedPath,
    projectRoot,
    config(),
    lockfile,
    0,
  );

  assert.match(
    result.markdown,
    /https:\/\/github\.com\/example\/other\/blob\/[0-9a-f]{40}\/README\.md#intro/,
  );
  assert.equal(lockfile.github["example/other@main"], otherRepository.commit);
});
