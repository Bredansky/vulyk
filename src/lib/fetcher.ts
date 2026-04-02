import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

export interface ResolvedSource {
  repoUrl: string;
  subPath: string | null;
  ref: string;
}

// Parse skill specifier into ResolvedSource.
// Formats:
//   owner/repo/path/to/skill           → HEAD of default branch
//   owner/repo/path/to/skill@main      → branch
//   owner/repo/path/to/skill@v1.2.0    → tag
//   owner/repo/path/to/skill@abc123f   → commit
//   https://github.com/owner/repo/tree/branch/path
//   https://github.com/owner/repo/blob/branch/path/SKILL.md  → uses parent dir
//   git@github.com:owner/repo.git
export function parseSource(specifier: string): ResolvedSource {
  // Full GitHub tree/blob URL
  if (specifier.startsWith("https://github.com/")) {
    const atIdx = specifier.lastIndexOf("@");
    const pinnedRef = atIdx > specifier.indexOf(".com/") ? specifier.slice(atIdx + 1) : null;
    const cleanSpecifier = pinnedRef ? specifier.slice(0, atIdx) : specifier;
    const url = new URL(cleanSpecifier);
    const parts = url.pathname.split("/").filter(Boolean);
    const repoUrl = `https://github.com/${parts[0]}/${parts[1]}.git`;
    if (parts.length > 4) {
      let subPath = parts.slice(4).join("/");
      if (subPath.endsWith("/SKILL.md")) subPath = subPath.slice(0, -"/SKILL.md".length);
      else if (subPath === "SKILL.md") subPath = "";
      return { repoUrl, subPath: subPath || null, ref: pinnedRef ?? parts[3] };
    }
    return { repoUrl, subPath: null, ref: pinnedRef ?? "HEAD" };
  }

  // Raw git URL
  if (specifier.startsWith("git@") || (specifier.startsWith("https://") && !specifier.includes("github.com"))) {
    return { repoUrl: specifier, subPath: null, ref: "HEAD" };
  }

  // owner/repo/path@version
  const atIdx = specifier.lastIndexOf("@");
  const ref = atIdx > 0 ? specifier.slice(atIdx + 1) : "HEAD";
  const withoutRef = atIdx > 0 ? specifier.slice(0, atIdx) : specifier;

  const parts = withoutRef.split("/");
  if (parts.length < 2) throw new Error(`Invalid skill specifier: "${specifier}"`);

  const repoUrl = `https://github.com/${parts[0]}/${parts[1]}.git`;
  let subPath = parts.length > 2 ? parts.slice(2).join("/") : null;
  if (subPath?.endsWith("/SKILL.md")) subPath = subPath.slice(0, -"/SKILL.md".length);
  else if (subPath === "SKILL.md") subPath = null;

  return { repoUrl, subPath, ref };
}

export function fetchSource(resolved: ResolvedSource, destDir: string): string {
  const cacheDir = path.join(os.homedir(), ".vulyk", "cache");
  fs.mkdirSync(cacheDir, { recursive: true });

  const repoHash = Buffer.from(resolved.repoUrl).toString("base64url").slice(0, 32);
  const repoCache = path.join(cacheDir, repoHash);

  if (!fs.existsSync(repoCache)) {
    execSync(`git clone --bare "${resolved.repoUrl}" "${repoCache}"`, { stdio: "pipe" });
  } else {
    execSync(`git --git-dir="${repoCache}" fetch --all --tags`, { stdio: "pipe" });
  }

  const commit = execSync(
    `git --git-dir="${repoCache}" rev-parse "${resolved.ref}"`,
    { encoding: "utf8", stdio: "pipe" }
  ).trim();

  fs.mkdirSync(destDir, { recursive: true });

  const archiveTarget = resolved.subPath ? `${resolved.ref}:${resolved.subPath}` : resolved.ref;

  // Check if subPath points to a single file (not a directory)
  if (resolved.subPath && resolved.subPath.includes(".")) {
    try {
      const objectType = execSync(
        `git --git-dir="${repoCache}" cat-file -t "${archiveTarget}"`,
        { encoding: "utf8", stdio: "pipe" }
      ).trim();

      if (objectType === "blob") {
        const fileName = path.basename(resolved.subPath);
        const content = execSync(
          `git --git-dir="${repoCache}" show "${archiveTarget}"`,
          { encoding: "utf8", stdio: "pipe" }
        );
        fs.writeFileSync(path.join(destDir, fileName), content);
        return commit;
      }
    } catch { /* fall through to archive */ }
  }

  const archivePath = path.join(os.tmpdir(), `vulyk-${Date.now()}.tar`);
  execSync(`git --git-dir="${repoCache}" archive --format=tar -o "${archivePath}" "${archiveTarget}"`, { stdio: "pipe" });
  execSync(`tar -x -f "${archivePath}" -C "${destDir}"`, { stdio: "pipe" });
  fs.rmSync(archivePath, { force: true });

  return commit;
}
