import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import type { LinkResolution } from "../types.js";
import { ensureGitRepoCache } from "./fetcher.js";
import { githubLockKey, type VulykLockfile } from "./lockfile.js";

interface GitHubSource {
  owner: string;
  repo: string;
  ref: string;
  sourcePath: string;
  repoUrl: string;
}

export interface MarkdownResolution {
  markdown: string;
  managedPaths: string[];
}

interface LinkMatch {
  target: string;
  start: number;
  end: number;
}

function parseGitHubSource(source: string): GitHubSource | null {
  if (!source.startsWith("https://github.com/")) return null;
  const parts = new URL(source).pathname.split("/").filter(Boolean);
  if (parts.length < 5 || parts[2] !== "blob") return null;
  const owner = parts[0];
  const repo = parts[1];
  const ref = parts[3];
  if (!owner || !repo || !ref) return null;
  return {
    owner,
    repo,
    ref,
    sourcePath: parts.slice(4).join("/"),
    repoUrl: `https://github.com/${owner}/${repo}.git`,
  };
}

function isCommit(ref: string): boolean {
  return /^[0-9a-f]{40}$/i.test(ref);
}

function extractLinks(markdown: string): LinkMatch[] {
  const links: LinkMatch[] = [];
  const pattern = /!?\[[^\]]*\]\((?<target>[^)\s]+)(?:\s+[^)]*)?\)/g;
  for (const match of markdown.matchAll(pattern)) {
    const target = match.groups?.target;
    const index = match.index;
    if (!target) continue;
    const start = index + match[0].indexOf(target);
    links.push({ target, start, end: start + target.length });
  }
  return links;
}

function splitFragment(target: string): { path: string; fragment: string } {
  const hash = target.indexOf("#");
  if (hash < 0) return { path: target, fragment: "" };
  return { path: target.slice(0, hash), fragment: target.slice(hash) };
}

function resolveProviderPath(sourcePath: string, linkPath: string): string {
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(sourcePath), linkPath),
  );
  if (resolved === ".." || resolved.startsWith("../")) {
    throw new Error(`relative link escapes provider repository: ${linkPath}`);
  }
  return resolved;
}

function objectType(
  repoCache: string,
  ref: string,
  providerPath: string,
): "blob" | "tree" | null {
  try {
    const result = execFileSync(
      "git",
      ["--git-dir", repoCache, "cat-file", "-t", `${ref}:${providerPath}`],
      { encoding: "utf8", stdio: "pipe" },
    ).trim();
    return result === "blob" || result === "tree" ? result : null;
  } catch {
    return null;
  }
}

function resolveCommit(
  github: GitHubSource,
  lockfile: VulykLockfile,
): { repoCache: string; commit: string } {
  const repoCache = ensureGitRepoCache(github.repoUrl);
  if (isCommit(github.ref)) return { repoCache, commit: github.ref };

  const key = githubLockKey(github.owner, github.repo, github.ref);
  const locked = lockfile.github[key];
  if (locked) return { repoCache, commit: locked };

  const commit = execFileSync(
    "git",
    ["--git-dir", repoCache, "rev-parse", github.ref],
    { encoding: "utf8", stdio: "pipe" },
  ).trim();
  if (!isCommit(commit)) {
    throw new Error(`GitHub ref could not be resolved: ${key}`);
  }
  lockfile.github[key] = commit;
  return { repoCache, commit };
}

function pinAbsoluteGitHubLink(
  target: string,
  lockfile: VulykLockfile,
): string | null {
  const { path: linkPath, fragment } = splitFragment(target);
  const github = parseGitHubSource(linkPath);
  if (!github) return null;
  const { commit } = resolveCommit(github, lockfile);
  return `https://github.com/${github.owner}/${github.repo}/blob/${commit}/${github.sourcePath}${fragment}`;
}

function outputPathFor(
  projectRoot: string,
  config: LinkResolution,
  providerPath: string,
): string {
  const root = config.sharedSourceRoot?.replace(/\/$/, "") ?? "";
  const relative = root
    ? path.posix.relative(root, providerPath)
    : providerPath;
  if (relative === ".." || relative.startsWith("../")) {
    throw new Error(
      `relative link is outside sharedSourceRoot: ${providerPath}`,
    );
  }
  return path.resolve(projectRoot, config.sharedOutputPath, relative);
}

function installGitObject(
  repoCache: string,
  ref: string,
  providerPath: string,
  outputPath: string,
): string[] {
  const type = objectType(repoCache, ref, providerPath);
  if (!type) throw new Error(`unresolved relative link: ${providerPath}`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  if (type === "blob") {
    const content = execFileSync(
      "git",
      ["--git-dir", repoCache, "show", `${ref}:${providerPath}`],
      { encoding: "utf8", stdio: "pipe" },
    );
    if (
      fs.existsSync(outputPath) &&
      fs.readFileSync(outputPath, "utf8") !== content
    ) {
      throw new Error(`shared output collision: ${outputPath}`);
    }
    fs.writeFileSync(outputPath, content);
    return [outputPath];
  }
  if (fs.existsSync(outputPath)) {
    throw new Error(`shared output collision: ${outputPath}`);
  }
  fs.mkdirSync(outputPath, { recursive: true });
  const archivePath = path.join(outputPath, ".vulyk-link.tar");
  try {
    execFileSync(
      "git",
      [
        "--git-dir",
        repoCache,
        "archive",
        "--format=tar",
        "-o",
        archivePath,
        ref,
        "--",
        providerPath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    execFileSync("tar", ["-xf", archivePath, "-C", outputPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } finally {
    fs.rmSync(archivePath, { force: true });
  }
  return [outputPath];
}

export function resolveMarkdownLinks(
  markdown: string,
  source: string,
  installedPath: string,
  projectRoot: string,
  config: LinkResolution,
  lockfile: VulykLockfile,
  depth: number,
): MarkdownResolution {
  const github = parseGitHubSource(source);
  if (!github) return { markdown, managedPaths: [] };
  const { repoCache, commit } = resolveCommit(github, lockfile);
  const replacements = extractLinks(markdown).reverse();
  let output = markdown;
  const managedPaths: string[] = [];

  for (const link of replacements) {
    const { path: linkPath, fragment } = splitFragment(link.target);
    if (!linkPath || linkPath.startsWith("#")) continue;

    if (/^https:\/\/github\.com\//i.test(linkPath)) {
      const pinned = pinAbsoluteGitHubLink(link.target, lockfile);
      if (!pinned) continue;
      output = `${output.slice(0, link.start)}${pinned}${output.slice(link.end)}`;
      continue;
    }

    if (/^[a-z][a-z\d+.-]*:/i.test(linkPath)) continue;

    const providerPath = resolveProviderPath(github.sourcePath, linkPath);
    const type = objectType(repoCache, commit, providerPath);
    if (!type) throw new Error(`unresolved relative link: ${providerPath}`);
    const localPath = outputPathFor(projectRoot, config, providerPath);

    if (type === "blob" && providerPath.toLowerCase().endsWith(".md")) {
      if (depth >= config.maxDepth) {
        throw new Error(`link resolution depth exceeded: ${linkPath}`);
      }
      const child = execFileSync(
        "git",
        ["--git-dir", repoCache, "show", `${commit}:${providerPath}`],
        { encoding: "utf8", stdio: "pipe" },
      );
      const childSource =
        `https://github.com/${github.owner}/${github.repo}/blob/` +
        `${commit}/${providerPath}`;
      const childOutput = resolveMarkdownLinks(
        child,
        childSource,
        localPath,
        projectRoot,
        config,
        lockfile,
        depth + 1,
      );
      managedPaths.push(
        ...installGitObject(repoCache, commit, providerPath, localPath),
      );
      fs.writeFileSync(localPath, childOutput.markdown);
      managedPaths.push(...childOutput.managedPaths);
    } else {
      managedPaths.push(
        ...installGitObject(repoCache, commit, providerPath, localPath),
      );
    }

    const installedDir = path.dirname(installedPath);
    const rewritten = `${path.relative(installedDir, localPath).replace(/\\/g, "/")}${fragment}`;
    output = `${output.slice(0, link.start)}${rewritten}${output.slice(link.end)}`;
  }

  return { markdown: output, managedPaths };
}
