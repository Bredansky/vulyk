import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync, execSync } from "node:child_process";
import { getRepoCachePath } from "./cache.js";

export interface ResolvedSource {
  repoUrl: string;
  subPath: string | null;
  ref: string;
}

// Parse skill specifier into ResolvedSource.
// Formats:
//   owner/repo/path/to/skill           -> HEAD of default branch
//   owner/repo/path/to/skill@main      -> branch
//   owner/repo/path/to/skill@v1.2.0    -> tag
//   owner/repo/path/to/skill@abc123f   -> commit
//   https://github.com/owner/repo/tree/branch/path
//   https://github.com/owner/repo/blob/branch/path/SKILL.md  -> uses parent dir
//   git@github.com:owner/repo.git
export function parseSource(specifier: string): ResolvedSource {
  // Full GitHub tree/blob URL
  if (specifier.startsWith("https://github.com/")) {
    const atIdx = specifier.lastIndexOf("@");
    const pinnedRef =
      atIdx > specifier.indexOf(".com/") ? specifier.slice(atIdx + 1) : null;
    const cleanSpecifier = pinnedRef ? specifier.slice(0, atIdx) : specifier;
    const url = new URL(cleanSpecifier);
    const parts = url.pathname.split("/").filter(Boolean);
    const owner = parts[0];
    const repo = parts[1];
    if (!owner || !repo) throw new Error(`Invalid GitHub URL: "${specifier}"`);
    const repoUrl = `https://github.com/${owner}/${repo}.git`;
    if (parts.length > 4) {
      let subPath = parts.slice(4).join("/");
      if (subPath.endsWith("/SKILL.md")) {
        subPath = subPath.slice(0, -"/SKILL.md".length);
      } else if (subPath === "SKILL.md") subPath = "";
      return {
        repoUrl,
        subPath: subPath || null,
        ref: pinnedRef ?? parts[3] ?? "HEAD",
      };
    }
    return { repoUrl, subPath: null, ref: pinnedRef ?? "HEAD" };
  }

  // Raw git URL
  if (
    specifier.startsWith("git@") ||
    (specifier.startsWith("https://") && !specifier.includes("github.com"))
  ) {
    return { repoUrl: specifier, subPath: null, ref: "HEAD" };
  }

  // owner/repo/path@version
  const atIdx = specifier.lastIndexOf("@");
  const ref = atIdx > 0 ? specifier.slice(atIdx + 1) : "HEAD";
  const withoutRef = atIdx > 0 ? specifier.slice(0, atIdx) : specifier;

  const parts = withoutRef.split("/");
  if (parts.length < 2) {
    throw new Error(`Invalid skill specifier: "${specifier}"`);
  }

  const owner = parts[0];
  const repo = parts[1];
  if (!owner || !repo) {
    throw new Error(`Invalid skill specifier: "${specifier}"`);
  }
  const repoUrl = `https://github.com/${owner}/${repo}.git`;
  let subPath = parts.length > 2 ? parts.slice(2).join("/") : null;
  if (subPath?.endsWith("/SKILL.md")) {
    subPath = subPath.slice(0, -"/SKILL.md".length);
  } else if (subPath === "SKILL.md") subPath = null;

  return { repoUrl, subPath, ref };
}

export function fetchSource(resolved: ResolvedSource, destDir: string): string {
  const cacheDir = path.join(os.homedir(), ".vulyk", "cache");
  fs.mkdirSync(cacheDir, { recursive: true });

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

  // Check if subPath points to a single file (not a directory)
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

  // Windows tar handling is inconsistent for drive-letter paths and stdin.
  // Use a zip archive plus native PowerShell extraction there, and tar elsewhere.
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
