import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
// NOTE: this module intentionally does NOT touch any per-directory marker
// file or the root .gitignore. The root .gitignore is owned exclusively
// by `vulyk sync` (via refreshGitignore). What this install DOES emit is
// the absolute paths of files/dirs it created, returned in InstallResult
// — callers feed that into .vulyk so a subsequent sync can
// detect stale entries via state.applyCleanupDelta(.
export function resolvePath(p: string): string {
  return p.startsWith("~")
    ? path.join(os.homedir(), p.slice(1))
    : path.resolve(p);
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

function copyDirCollecting(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED_DIR_NAMES.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirCollecting(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
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
  /** @deprecated retained for backwards compat; ignored. */
  gitignore?: boolean;
  preservePaths?: string[];
  /**
   * When true, a single-file-in-dir source is treated as a folder
   * (preserving the user's local structure). Default false — remote
   * sources fetched into a temp dir unwrap to a single flat-file
   * install.
   */
  preserveFolderForSingleFile?: boolean;
}

export interface InstallResult {
  installName: string;
  /** Absolute paths of files/dirs created or refreshed by this call. */
  managedPaths: string[];
}

/**
 * @internal
 *
 * Classify the source: file install vs folder install, with the
 * effective source path (for single-file-in-dir cases) and file ext.
 *
 * Exported for tests. Behavioural contract unchanged from v0.10.2:
 * the unwrap heuristic fires only when the source dir contains
 * EXACTLY ONE file AND NO subdirectories.
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
  if (preserveFolderForSingleFile) {
    return { isFileInstall: false, effectiveSrc: srcPath, ext: "" };
  }
  const entries = fs.readdirSync(srcPath, { withFileTypes: true });
  const fileNames = entries.filter((e) => e.isFile()).map((e) => e.name);
  const dirNames = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  if (fileNames.length === 1 && dirNames.length === 0) {
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
 * Returns the install name and the absolute paths of files/dirs that
 * were actually created (or refreshed) on disk. Callers collect those
 * paths into `.vulyk` so the next `vulyk sync`/`agents` can
 * compute set-difference cleanups.
 */
export function install(
  packageName: string,
  srcPath: string,
  outputPaths: string[],
  opts: InstallOptions = {},
): InstallResult {
  const { isFileInstall, effectiveSrc, ext } = classifySource(
    srcPath,
    opts.preserveFolderForSingleFile ?? false,
  );

  const installName = isFileInstall
    ? packageName
    : resolveDirInstallName(packageName, srcPath);

  const managedPaths: string[] = [];

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
      managedPaths.push(dest);
    } else {
      const dest = path.join(resolved, installName);
      if (isPreservedPath(dest, opts.preservePaths)) continue;
      const srcSameAsDest = path.resolve(srcPath) === path.resolve(dest);
      if (srcSameAsDest) continue;

      // Wipe the previous install so the new copy is a clean snapshot.
      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
      }
      copyDirCollecting(srcPath, dest);
      managedPaths.push(dest);
    }
  }
  return { installName, managedPaths };
}

/**
 * Remove an entry from one or more output paths. Used by
 * `vulyk remove` and by `vulyk sync` when an entry is disabled.
 */
export function uninstall(
  installName: string,
  outputPaths: string[],
  opts?: {
    preservePaths?: string[];
    isDir?: boolean;
    ext?: string;
    fileBaseNames?: string[];
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
      const fileBaseNames = opts?.fileBaseNames ?? [`${installName}${ext}`];
      for (const baseName of fileBaseNames) {
        const dest = path.join(resolved, baseName);
        if (isPreservedPath(dest, opts?.preservePaths)) continue;
        if (fs.existsSync(dest)) fs.rmSync(dest, { force: true });
      }
    }
  }
}
