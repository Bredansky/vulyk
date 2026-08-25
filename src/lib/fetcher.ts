import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { getProjectTempPath, getRepoCachePath } from "./cache.js";
import { writeTextFile } from "./text.js";

export interface GitResolvedSource {
  kind: "git";
  repoUrl: string;
  subPath: string | null;
  ref: string;
}

export interface UrlResolvedSource {
  kind: "url";
  url: string;
}

export type ResolvedSource = GitResolvedSource | UrlResolvedSource;

/**
 * GitHub blob fetches are written as one file inside the temporary fetch
 * directory. Pass that file to the installer so a single-file entry remains
 * a flat managed file rather than becoming a directory named after the entry.
 */
export function resolveFetchedInstallSource(
  specifier: string,
  tmpDir: string,
): string {
  if (!specifier.includes("/blob/")) return tmpDir;

  const entries = fs.readdirSync(tmpDir, { withFileTypes: true });
  if (entries.length !== 1 || !entries[0]?.isFile()) return tmpDir;

  return path.join(tmpDir, entries[0].name);
}

export function refreshGitRepoCache(repoCache: string): void {
  execFileSync(
    "git",
    [
      "--git-dir",
      repoCache,
      "fetch",
      "origin",
      "+refs/heads/*:refs/heads/*",
      "+refs/tags/*:refs/tags/*",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
}

export function ensureGitRepoCache(repoUrl: string): string {
  const repoCache = getRepoCachePath(repoUrl);

  if (!fs.existsSync(repoCache)) {
    execFileSync("git", ["clone", "--bare", repoUrl, repoCache], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } else {
    refreshGitRepoCache(repoCache);
  }

  return repoCache;
}

function isDirectUrl(specifier: string): boolean {
  if (!specifier.startsWith("http://") && !specifier.startsWith("https://")) {
    return false;
  }

  if (specifier.startsWith("https://github.com/")) {
    return false;
  }

  return !specifier.endsWith(".git");
}

export function parseSource(specifier: string): ResolvedSource {
  if (isDirectUrl(specifier)) {
    return { kind: "url", url: specifier };
  }

  if (specifier.startsWith("https://github.com/")) {
    const url = new URL(specifier);
    const parts = url.pathname.split("/").filter(Boolean);
    const owner = parts[0];
    const repo = parts[1];
    if (!owner || !repo) throw new Error(`Invalid GitHub URL: "${specifier}"`);
    const repoUrl = `https://github.com/${owner}/${repo}.git`;
    if (parts.length >= 5 && (parts[2] === "blob" || parts[2] === "tree")) {
      let subPath = parts.slice(4).join("/");
      if (subPath.endsWith("/SKILL.md")) {
        subPath = subPath.slice(0, -"/SKILL.md".length);
      } else if (subPath === "SKILL.md") {
        subPath = "";
      }
      return {
        kind: "git",
        repoUrl,
        subPath: subPath || null,
        ref: parts[3] ?? "HEAD",
      };
    }
    throw new Error(
      `Unsupported GitHub source: "${specifier}". Use a blob/tree URL with a path.`,
    );
  }

  throw new Error(
    `Unsupported source "${specifier}". Use a direct URL or a full GitHub blob/tree URL.`,
  );
}

function fetchGitSource(resolved: GitResolvedSource, destDir: string): string {
  const repoCache = ensureGitRepoCache(resolved.repoUrl);

  const commit = execSync(
    `git --git-dir="${repoCache}" rev-parse "${resolved.ref}"`,
    { encoding: "utf8", stdio: "pipe" },
  ).trim();

  fs.mkdirSync(destDir, { recursive: true });

  const archiveTarget = resolved.subPath
    ? `${resolved.ref}:${resolved.subPath}`
    : resolved.ref;

  if (resolved.subPath?.includes(".")) {
    try {
      const objectType = execSync(
        `git --git-dir="${repoCache}" cat-file -t "${archiveTarget}"`,
        { encoding: "utf8", stdio: "pipe" },
      ).trim();

      if (objectType === "blob") {
        const fileName = path.basename(resolved.subPath);
        const content = execSync(
          `git --git-dir="${repoCache}" show "${archiveTarget}"`,
          { encoding: "utf8", stdio: "pipe" },
        );
        writeTextFile(path.join(destDir, fileName), content);
        return commit;
      }
    } catch {
      /* fall through to archive */
    }
  }

  const archiveDir = getProjectTempPath("archives");
  fs.mkdirSync(archiveDir, { recursive: true });

  if (process.platform === "win32") {
    const archivePath = path.join(
      archiveDir,
      `vulyk-${String(process.pid)}-${String(Date.now())}.zip`,
    );
    execFileSync(
      "git",
      [
        "--git-dir",
        repoCache,
        "archive",
        "--format=zip",
        "-o",
        archivePath,
        archiveTarget,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "& { param($archivePath, $destDir) Expand-Archive -LiteralPath $archivePath -DestinationPath $destDir -Force }",
        archivePath,
        destDir,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    fs.rmSync(archivePath, { force: true });
  } else {
    const archivePath = path.join(
      archiveDir,
      `vulyk-${String(process.pid)}-${String(Date.now())}.tar`,
    );
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
          archiveTarget,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      execFileSync("tar", ["-x", "-C", destDir, "-f", archivePath], {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } finally {
      fs.rmSync(archivePath, { force: true });
    }
  }

  return commit;
}

function inferFileNameFromUrl(url: string, contentType: string | null): string {
  const pathname = new URL(url).pathname;
  const baseName = path.basename(pathname);
  if (baseName.includes(".")) {
    return baseName;
  }
  if (contentType?.includes("markdown")) return "document.md";
  if (contentType?.includes("zip")) return "archive.zip";
  return "download.bin";
}

async function fetchUrlSource(
  resolved: UrlResolvedSource,
  destDir: string,
): Promise<null> {
  fs.mkdirSync(destDir, { recursive: true });

  const response = await fetch(resolved.url);
  if (!response.ok) {
    throw new Error(`HTTP ${String(response.status)} for ${resolved.url}`);
  }

  const contentType = response.headers.get("content-type");
  const fileName = inferFileNameFromUrl(resolved.url, contentType);
  const outputPath = path.join(destDir, fileName);

  if (contentType?.includes("markdown") || fileName.endsWith(".md")) {
    writeTextFile(outputPath, await response.text());
    return null;
  }

  if (
    contentType?.includes("zip") ||
    fileName.endsWith(".zip") ||
    fileName.endsWith(".tgz") ||
    fileName.endsWith(".tar.gz") ||
    fileName.endsWith(".tar")
  ) {
    const archivePath = outputPath;
    fs.writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()));

    if (archivePath.endsWith(".zip")) {
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          "& { param($archivePath, $destDir) Expand-Archive -LiteralPath $archivePath -DestinationPath $destDir -Force }",
          archivePath,
          destDir,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
    } else {
      execFileSync("tar", ["-x", "-f", archivePath, "-C", destDir], {
        stdio: ["ignore", "pipe", "pipe"],
      });
    }

    fs.rmSync(archivePath, { force: true });
    return null;
  }

  fs.writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
  return null;
}

export async function fetchSource(
  resolved: ResolvedSource,
  destDir: string,
): Promise<string | null> {
  if (resolved.kind === "git") {
    return fetchGitSource(resolved, destDir);
  }

  return fetchUrlSource(resolved, destDir);
}
