import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync, execSync } from "node:child_process";
import { getRepoCachePath } from "./cache.js";

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
  const repoCache = getRepoCachePath(resolved.repoUrl);

  if (!fs.existsSync(repoCache)) {
    execSync(`git clone --bare "${resolved.repoUrl}" "${repoCache}"`, {
      stdio: "pipe",
    });
  } else {
    execSync(`git --git-dir="${repoCache}" fetch --all --tags`, {
      stdio: "pipe",
    });
  }

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
        fs.writeFileSync(path.join(destDir, fileName), content);
        return commit;
      }
    } catch {
      /* fall through to archive */
    }
  }

  if (process.platform === "win32") {
    const archivePath = path.join(
      os.tmpdir(),
      `vulyk-${String(Date.now())}.zip`,
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
    const archive = execFileSync(
      "git",
      ["--git-dir", repoCache, "archive", "--format=tar", archiveTarget],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    execFileSync("tar", ["-x", "-C", destDir, "-f", "-"], {
      input: archive,
      stdio: ["pipe", "pipe", "pipe"],
    });
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
    fs.writeFileSync(outputPath, await response.text());
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
  const cacheDir = path.join(os.homedir(), ".vulyk", "cache");
  fs.mkdirSync(cacheDir, { recursive: true });

  if (resolved.kind === "git") {
    return fetchGitSource(resolved, destDir);
  }

  return fetchUrlSource(resolved, destDir);
}
