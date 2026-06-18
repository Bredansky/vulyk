import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { updateRootGitignore, getRootGitignoreEntries } from "./gitignore.js";

export function resolvePath(p: string): string {
  return p.startsWith("~")
    ? path.join(os.homedir(), p.slice(1))
    : path.resolve(p);
}

const MARKER = ".vulyk";
const MARKER_PREFIX = "🍯 ";

export interface InstallOptions {
  preservePaths?: string[];
  gitignore?: boolean;
}

/**
 * Read a `.vulyk` manifest from a directory. Returns the set of relative file
 * paths the previous install wrote there. Empty set if no manifest exists.
 */
export function readManifestFiles(dir: string): Set<string> {
  const markerPath = path.join(dir, MARKER);
  if (!fs.existsSync(markerPath)) return new Set();
  const body = fs.readFileSync(markerPath, "utf8");
  const files = new Set<string>();
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === "🍯") continue; // legacy single-line marker
    if (!trimmed.startsWith(MARKER_PREFIX)) continue;
    const file = trimmed.slice(MARKER_PREFIX.length).trim();
    if (file) files.add(file);
  }
  return files;
}

/**
 * Write a `.vulyk` manifest to a directory.
 */
export function writeManifestFiles(dir: string, files: Iterable<string>): void {
  const markerPath = path.join(dir, MARKER);
  const sorted = [...new Set(files)].sort();
  if (sorted.length === 0) {
    if (fs.existsSync(markerPath)) fs.rmSync(markerPath, { force: true });
    return;
  }
  const body = `${sorted.map((f) => `${MARKER_PREFIX}${f}`).join("\n")}\n`;
  fs.writeFileSync(markerPath, body);
}

/**
 * Remove a `.vulyk` manifest from a directory.
 */
export function clearManifest(dir: string): void {
  const markerPath = path.join(dir, MARKER);
  if (fs.existsSync(markerPath)) fs.rmSync(markerPath, { force: true });
}

/**
 * Recursively copy a directory, recording every file (relative to destRoot)
 * into the manifest accumulator. Skips the `.vulyk` marker.
 */
function copyDirCollecting(
  src: string,
  dest: string,
  destRoot: string,
  manifest: Set<string>,
): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === MARKER) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirCollecting(srcPath, destPath, destRoot, manifest);
    } else {
      fs.copyFileSync(srcPath, destPath);
      manifest.add(path.relative(destRoot, destPath));
    }
  }
}

function readSkillName(srcDir: string): string | null {
  const skillFile = path.join(srcDir, "SKILL.md");
  if (!fs.existsSync(skillFile)) return null;
  const content = fs.readFileSync(skillFile, "utf8");
  const match = /^---\r?\n(?<fm>[\s\S]*?)\r?\n---/.exec(content);
  if (!match) return null;
  const nameLine = (match.groups?.fm ?? "")
    .split("\n")
    .find((l) => l.trimStart().startsWith("name:"));
  return nameLine
    ? (nameLine.split(":")[1] ?? "").trim().replace(/^["']|["']$/g, "")
    : null;
}

function normalizeAbsolutePath(value: string): string {
  return path.resolve(value);
}

function isPreservedPath(
  candidate: string,
  preservePaths: string[] | undefined,
): boolean {
  if (!preservePaths || preservePaths.length === 0) return false;
  const normalizedCandidate = normalizeAbsolutePath(candidate);
  return preservePaths.some(
    (preservePath) =>
      normalizeAbsolutePath(preservePath) === normalizedCandidate,
  );
}

/**
 * Resolve the install name for a directory source.
 * Reads SKILL.md frontmatter `name` field, falling back to packageName.
 */
export function resolveDirInstallName(
  packageName: string,
  srcDir: string,
): string {
  return readSkillName(srcDir) ?? packageName;
}

/**
 * Generic install — auto-detects directory vs file source.
 * Writes a `.vulyk` manifest in the install location listing every file
 * vulyk created, so cleanup can leave user-added files alone.
 */
export function install(
  packageName: string,
  srcPath: string,
  outputPaths: string[],
  opts?: InstallOptions,
): string {
  const stat = fs.statSync(srcPath);
  const isDir = stat.isDirectory();

  const installName = isDir
    ? resolveDirInstallName(packageName, srcPath)
    : packageName;

  for (const outputPath of outputPaths) {
    const resolved = resolvePath(outputPath);

    if (isDir) {
      const dest = path.join(resolved, installName);
      if (isPreservedPath(dest, opts?.preservePaths)) continue;
      const srcSameAsDest = path.resolve(srcPath) === path.resolve(dest);
      if (srcSameAsDest) continue;

      // Wipe the previous install (and its manifest) so the new copy is
      // a clean snapshot. User-added files outside the manifest are
      // protected because we only ever delete the install dir wholesale.
      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
      }
      const manifest = new Set<string>();
      copyDirCollecting(srcPath, dest, dest, manifest);
      writeManifestFiles(dest, manifest);
    } else {
      const ext = path.extname(srcPath);
      const dest = path.join(resolved, `${installName}${ext}`);
      if (isPreservedPath(dest, opts?.preservePaths)) continue;
      const srcSameAsDest = path.resolve(srcPath) === path.resolve(dest);
      if (srcSameAsDest) continue;

      fs.mkdirSync(resolved, { recursive: true });
      if (fs.existsSync(dest)) fs.rmSync(dest, { force: true });
      fs.copyFileSync(srcPath, dest);

      // Add to the shared manifest in the output dir, preserving any
      // files from other entries that share the dir.
      const manifest = readManifestFiles(resolved);
      manifest.add(path.basename(dest));
      writeManifestFiles(resolved, manifest);
    }
  }

  // Gitignore handling.
  // - If the manifest explicitly set gitIgnore, use it.
  // - Otherwise default to a per-path heuristic: gitignore a path unless
  //   the install location is the same as the source (i.e. a local source
  //   that lives at the same path as one of its declared output paths —
  //   we don't want to gitignore the user's own source code).
  if (opts?.gitignore !== false) {
    const entries = new Set(getRootGitignoreEntries());
    for (const outputPath of outputPaths) {
      const resolved = resolvePath(outputPath);
      const dest = isDir
        ? path.join(resolved, installName)
        : path.join(resolved, `${installName}${path.extname(srcPath)}`);
      if (isPreservedPath(dest, opts?.preservePaths)) continue;
      const srcSameAsDest = path.resolve(srcPath) === path.resolve(dest);
      // If the caller passed gitignore=true explicitly, gitignore all paths.
      // If it's undefined (default), skip srcSameAsDest paths but gitignore
      // the rest.
      if (srcSameAsDest && opts?.gitignore === undefined) continue;
      const relativeEntry = isDir
        ? `${outputPath}/${installName}/`
        : `${outputPath}/${installName}${path.extname(srcPath)}`;
      entries.add(relativeEntry);
    }
    updateRootGitignore([...entries].sort());
  }

  return installName;
}

export function uninstall(
  installName: string,
  outputPaths: string[],
  opts?: {
    preservePaths?: string[];
    isDir?: boolean;
    ext?: string;
    fileBaseNames?: string[]; // for file installs: full base names of files to drop from manifest
  },
): void {
  const isDir = opts?.isDir ?? true;
  const ext = opts?.ext ?? "";

  for (const outputPath of outputPaths) {
    const resolved = resolvePath(outputPath);
    if (isDir) {
      const dest = path.join(resolved, installName);
      if (isPreservedPath(dest, opts?.preservePaths)) continue;
      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
      }
    } else {
      // For file installs, remove the file and its entry from the
      // shared output-dir manifest.
      const fileBaseNames = opts?.fileBaseNames ?? [`${installName}${ext}`];
      for (const baseName of fileBaseNames) {
        const dest = path.join(resolved, baseName);
        if (isPreservedPath(dest, opts?.preservePaths)) continue;
        if (fs.existsSync(dest)) fs.rmSync(dest, { force: true });
      }
      const manifest = readManifestFiles(resolved);
      for (const baseName of fileBaseNames) {
        manifest.delete(baseName);
      }
      writeManifestFiles(resolved, manifest);
    }
  }
}

/**
 * Add files to a `.vulyk` manifest in a directory without touching the
 * filesystem contents. Used by the AGENTS.md generator.
 */
export function addToManifest(dir: string, files: Iterable<string>): void {
  const manifest = readManifestFiles(dir);
  for (const file of files) manifest.add(file);
  writeManifestFiles(dir, manifest);
}

/**
 * Remove files from a `.vulyk` manifest in a directory without touching
 * the filesystem contents. Returns true if any files were removed.
 */
export function removeFromManifest(
  dir: string,
  files: Iterable<string>,
): boolean {
  const manifest = readManifestFiles(dir);
  let changed = false;
  for (const file of files) {
    if (manifest.delete(file)) changed = true;
  }
  writeManifestFiles(dir, manifest);
  return changed;
}

export function isManagedByVulyk(dir: string): boolean {
  return fs.existsSync(path.join(dir, MARKER));
}

export { MARKER };
