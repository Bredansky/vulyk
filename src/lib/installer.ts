import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
// NOTE: this module intentionally does NOT import updateRootGitignore or
// getRootGitignoreEntries from "./gitignore.js". The root .gitignore is
// managed exclusively by `vulyk sync`, via `refreshGitignore()` in
// "./gitignore.ts", which inspects the filesystem to derive the correct
// entries. Likewise `install()` no longer mutates .gitignore (see body).

export function resolvePath(p: string): string {
  return p.startsWith("~")
    ? path.join(os.homedir(), p.slice(1))
    : path.resolve(p);
}

const MARKER = ".vulyk";
const MARKER_PREFIX = "🍯 ";

export function readManifestFiles(dir: string): Set<string> {
  const markerPath = path.join(dir, MARKER);
  if (!fs.existsSync(markerPath)) return new Set();
  const content = fs.readFileSync(markerPath, "utf8");
  const files = new Set<string>();
  for (const line of content.split("\n")) {
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

const IGNORED_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  ".next",
  ".turbo",
  ".yarn",
  "dist",
  "build",
  "coverage",
]);

function copyDirCollecting(
  src: string,
  dest: string,
  base: string,
  manifest: Set<string>,
): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED_DIR_NAMES.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirCollecting(srcPath, destPath, base, manifest);
    } else {
      fs.copyFileSync(srcPath, destPath);
      manifest.add(path.relative(base, destPath));
    }
  }
}

function isPreservedPath(
  dest: string,
  preserve: string[] | undefined,
): boolean {
  if (!preserve) return false;
  return preserve.some((p) => path.resolve(p) === path.resolve(dest));
}

function resolveDirInstallName(packageName: string, _srcPath: string): string {
  return packageName;
}

export interface InstallOptions {
  gitignore?: boolean;
  preservePaths?: string[];
  /**
   * When true, a single-file-in-dir source is treated as a folder
   * (preserving the user's local structure). Set this for local sources
   * where the folder shape is intentional. Remote sources fetched into a
   * temp dir should leave it false (default) so a single-file dir is
   * installed as a flat file.
   */
  preserveFolderForSingleFile?: boolean;
}

/**
 * @internal
 *
 * Classify the source: file install vs folder install, with the effective
 * source path (for single-file-in-dir cases) and the file extension.
 *
 * Exported so tests can exercise the (1-file-+-N-dirs) shape directly,
 * without going through the full install() pipeline. Not part of the
 * vulyk CLI public surface.
 */
export function classifySource(
  srcPath: string,
  preserveFolderForSingleFile: boolean,
): {
  isFileInstall: boolean;
  effectiveSrc: string;
  ext: string;
} {
  const stat = fs.statSync(srcPath);
  if (stat.isFile()) {
    return {
      isFileInstall: true,
      effectiveSrc: srcPath,
      ext: path.extname(srcPath),
    };
  }
  // It's a directory. If we should preserve the folder shape, treat as
  // folder install regardless of contents.
  if (preserveFolderForSingleFile) {
    return { isFileInstall: false, effectiveSrc: srcPath, ext: "" };
  }
  // Otherwise, check if it's a single-file dir — the typical shape of a
  // remote blob source fetched into a temp dir. Treat as file install.
  // We only unwrap when there is EXACTLY ONE file AND NO subdirectories.
  // A tree source that happens to have just one top-level file alongside
  // any number of subdirs (e.g. a pasika/tree/<sha>/<name> containing
  // <name>.md + <name>/, references/, rules/) must still install as a
  // folder so the subdirs aren't silently dropped.
  const entries = fs.readdirSync(srcPath, { withFileTypes: true });
  const fileNames = entries.filter((e) => e.isFile()).map((e) => e.name);
  const dirNames = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  if (fileNames.length === 1 && dirNames.length === 0) {
    // noUncheckedIndexedAccess widens fileNames[0] to `string | undefined`
    // even though the length guard just confirmed otherwise, so we
    // assign into `single` and explicitly check for undefined. The
    // length check above already guarantees `single` is a string here;
    // the runtime guard is for the type checker, not the runtime, so it
    // throws rather than silently dropping the install.
    const single = fileNames[0];
    if (single === undefined) {
      throw new Error("classifySource: length === 1 but first element missing");
    }
    const singleFile = path.join(srcPath, single);
    return {
      isFileInstall: true,
      effectiveSrc: singleFile,
      ext: path.extname(singleFile),
    };
  }
  return { isFileInstall: false, effectiveSrc: srcPath, ext: "" };
}

/**
 * Install an entry from a source path into one or more output paths.
 *
 * Source kinds:
 *  - File: installs as a flat file at <output>/<name><ext>.
 *  - Folder: copies the whole folder to <output>/<name>/.
 *  - Single-file-in-dir (typical for fetched remote blobs): installs as a
 *    flat file, using the single file's name and extension.
 *
 * vulyk created, so cleanup can leave user-added files alone.
 */
export function install(
  packageName: string,
  srcPath: string,
  outputPaths: string[],
  opts: InstallOptions = {},
): string {
  const { isFileInstall, effectiveSrc, ext } = classifySource(
    srcPath,
    opts.preserveFolderForSingleFile ?? false,
  );

  const installName = isFileInstall
    ? packageName
    : resolveDirInstallName(packageName, srcPath);

  for (const outputPath of outputPaths) {
    const resolved = resolvePath(outputPath);

    if (isFileInstall) {
      const dest = path.join(resolved, `${installName}${ext}`);
      if (isPreservedPath(dest, opts.preservePaths)) continue;
      const srcSameAsDest = path.resolve(effectiveSrc) === path.resolve(dest);
      if (srcSameAsDest) continue;

      fs.mkdirSync(resolved, { recursive: true });
      if (fs.existsSync(dest)) fs.rmSync(dest, { force: true });
      fs.copyFileSync(effectiveSrc, dest);

      // Add to the shared manifest in the output dir, preserving any
      // files from other entries that share the dir.
      const manifest = readManifestFiles(resolved);
      manifest.add(path.basename(dest));
      writeManifestFiles(resolved, manifest);
    } else {
      const dest = path.join(resolved, installName);
      if (isPreservedPath(dest, opts.preservePaths)) continue;
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
    }
  }

  // Gitignore ownership: this function does NOT mutate the root
  // `.gitignore`. The vulyk-managed block is owned exclusively by
  // `vulyk sync`, which calls `refreshGitignore()` in "./gitignore.ts"
  // at the end of a sync run. That helper inspects the filesystem to
  // derive the correct set of entries, so per-install bookkeeping here
  // was redundant for sync and would otherwise accumulate stale
  // entries across `vulyk update` / `vulyk add` runs (neither of
  // which is responsible for gitignore cleanup).
  //
  // `vulyk agents` does not call `install()` at all, so it never
  // touches `.gitignore` either way. The `opts.gitignore` field is
  // retained for backwards compatibility but is no-op here — run
  // `vulyk sync` to ensure `.gitignore` is current.

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
