import * as fs from "node:fs";
import * as path from "node:path";
import type { Manifest } from "../types.js";
import { readManifestFiles } from "./installer.js";
import { isEnabled, resolveOutputPaths } from "./groups.js";
import { log } from "./log.js";

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

interface ExpectedInstall {
  /** Absolute path to the installed file or dir. */
  abs: string;
  /** True for a dir install, false for a file install. */
  isDir: boolean;
}

interface ExpectedState {
  /** All install locations (dirs + individual files) that should exist. */
  installs: ExpectedInstall[];
  /** Dir install locations: the installed dirs themselves. */
  dirInstallDirs: Set<string>;
  /** Output dirs that have at least one file install inside. */
  fileInstallParentDirs: Set<string>;
  /** Individual files that should exist. */
  expectedFiles: Set<string>;
}

function computeExpected(
  manifest: Manifest,
  projectRoot: string,
): ExpectedState {
  const installs: ExpectedInstall[] = [];
  const dirInstallDirs = new Set<string>();
  const fileInstallParentDirs = new Set<string>();
  const expectedFiles = new Set<string>();
  for (const [name, entry] of Object.entries(manifest.entries)) {
    if (!isEnabled(manifest, name)) continue;
    const outPaths = resolveOutputPaths(manifest, name);
    if (outPaths.length === 0) continue;
    const isLocal = fs.existsSync(path.resolve(projectRoot, entry.source));
    // Install-shape decision (mirrors installer.classifySource):
    //   - local file/dir  -> match on-disk shape (file or dir)
    //   - remote URL whose path ends in a file extension
    //     (e.g. pasika/blob/<sha>/foo.md, https://example.com/docs.md)
    //     -> single-file fetch + flat file install
    //   - remote URL with no extension (e.g. pasika/tree/<sha>/docs)
    //     -> directory install
    //   - non-local AND non-URL-shaped (e.g. legacy source: "alpha.md"
    //     whose on-disk install is a directory): keep legacy
    //     directory-install behaviour. The cleanupStale group-root
    //     tests rely on this so legacy entries don't get their `.vulyk`
    //     parent nuked.
    const sourceExt = path.extname(entry.source);
    const looksLikeUrl =
      /^https?:\/\//i.test(entry.source) ||
      (entry.source.includes("/") && !isLocal);
    const isRemoteSingleFile = !isLocal && looksLikeUrl && sourceExt.length > 0;
    const sourceIsDir = isLocal
      ? fs.statSync(path.resolve(projectRoot, entry.source)).isDirectory()
      : !isRemoteSingleFile;
    let sourceBase: string;
    if (sourceExt.length > 0) {
      sourceBase = path.basename(entry.source, sourceExt);
    } else if (isLocal) {
      sourceBase = path.basename(entry.source);
    } else {
      sourceBase = name;
    }
    for (const outPath of outPaths) {
      // Resolve relative to projectRoot, not CWD. vulyk commands may be
      // invoked from any directory; the manifest's paths are always
      // anchored at the manifest's location.
      const resolved = path.resolve(projectRoot, outPath);
      if (sourceIsDir) {
        const dirPath = path.join(resolved, name);
        dirInstallDirs.add(path.resolve(dirPath));
        installs.push({ abs: dirPath, isDir: true });
      } else {
        const filePath = path.join(resolved, `${sourceBase}${sourceExt}`);
        fileInstallParentDirs.add(path.resolve(resolved));
        expectedFiles.add(path.resolve(filePath));
        installs.push({ abs: filePath, isDir: false });
      }
    }
  }
  return { installs, dirInstallDirs, fileInstallParentDirs, expectedFiles };
}

function removeFile(absPath: string, projectRoot: string): void {
  if (!fs.existsSync(absPath)) return;
  fs.rmSync(absPath, { force: true });
  log.dim(`  removed ${path.relative(projectRoot, absPath)}`);
}

function removeDir(absPath: string, projectRoot: string): void {
  if (!fs.existsSync(absPath)) return;
  fs.rmSync(absPath, { recursive: true, force: true });
  log.dim(`  removed ${path.relative(projectRoot, absPath)}`);
}

function* findManagedDirs(
  root: string,
): Generator<{ dir: string; kind: "dir-install" | "file-install-dir" }> {
  if (!fs.existsSync(root)) return;
  const markerPath = path.join(root, ".vulyk");
  if (fs.existsSync(markerPath)) {
    // Heuristic: a dir with a `.vulyk` could be either a dir install (e.g.
    // `managed-skills/alpha/`) or a file install output dir (e.g.
    // `docs/external/`). We yield both; the caller decides what to do.
    yield { dir: root, kind: "dir-install" };
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (IGNORED_DIR_NAMES.has(entry.name)) continue;
    yield* findManagedDirs(path.join(root, entry.name));
  }
}

/**
 * Read the `.vulyk` manifest in `absDir`, drop any DIRECT file no longer
 * claimed by an enabled entry, and rewrite the manifest. Subdir paths
 * (those containing a separator) are preserved — those describe child
 * dir installs that have their own `.vulyk` manifests and are tracked
 * separately.
 */
function cleanupFileInstallManifest(
  absDir: string,
  expected: ExpectedState,
  projectRoot: string,
): void {
  const manifestFiles = readManifestFiles(absDir);
  if (manifestFiles.size === 0) return;
  const kept: string[] = [];
  for (const file of manifestFiles) {
    // Subdir entries in a parent .vulyk manifest describe child dir
    // installs (e.g. `alpha/.vulyk`). Those have their own .vulyk
    // manifest and are tracked via expected.dirInstallDirs — leave
    // them alone.
    if (file.includes("/") || file.includes(path.sep)) {
      kept.push(file);
      continue;
    }
    const filePath = path.join(absDir, file);
    if (expected.expectedFiles.has(path.resolve(filePath))) {
      kept.push(file);
      continue;
    }
    removeFile(filePath, projectRoot);
  }
  const markerPath = path.join(absDir, ".vulyk");
  if (kept.length === 0) {
    if (fs.existsSync(markerPath)) fs.rmSync(markerPath, { force: true });
  } else {
    const body = `${kept
      .sort()
      .map((f) => `🍯 ${f}`)
      .join("\n")}\n`;
    fs.writeFileSync(markerPath, body);
  }
}

/**
 * Single cleanup pass for all kinds (dir installs, file installs, AGENTS.md).
 *
 * The `.vulyk` manifest is the source of truth for what vulyk created. Files
 * NOT in any manifest are user files and are never touched.
 *
 * Algorithm:
 *  1. Compute the expected set of installs from the manifest.
 *  2. Walk all `.vulyk` manifests in the project.
 *  3. For each managed dir:
 *     - If it's a dir install in the expected set: the dir is fine, but
 *       the manifest inside should match the new install (we don't touch
 *       files inside because the next install() will refresh them).
 *     - If it's a group install root: also prune any stale file-install
 *       entries in its `.vulyk` manifest (e.g. local docs reclassified
 *       into a group with no outputPaths).
 *     - If it's a file install output dir: read the manifest, remove
 *       listed files that are no longer expected.
 *     - If it's not claimed by any entry: remove the whole dir.
 */
export function cleanupStale(manifest: Manifest, projectRoot: string): void {
  const expected = computeExpected(manifest, projectRoot);
  const fileInstallOutputDirs = new Set<string>();
  for (const exp of expected.installs) {
    if (!exp.isDir) {
      fileInstallOutputDirs.add(path.resolve(path.dirname(exp.abs)));
    }
  }

  for (const { dir } of [...findManagedDirs(projectRoot)]) {
    const absDir = path.resolve(dir);

    if (expected.dirInstallDirs.has(absDir)) {
      // Expected dir install: leave the dir alone. The next install() will
      // refresh its contents and overwrite the .vulyk manifest.
      continue;
    }

    // Group install root: this dir's `.vulyk` marker is at a parent of
    // the per-entry install dirs (e.g. `docs/external/.vulyk` parents
    // `docs/external/<entry-name>/`). It may ALSO hold stale file-install
    // entries from before an entry moved to a no-outputPaths group —
    // prune those via the shared file-install cleanup.
    const isGroupInstallRoot = [...expected.dirInstallDirs].some((entryDir) =>
      entryDir.startsWith(absDir + path.sep),
    );
    if (isGroupInstallRoot) {
      cleanupFileInstallManifest(absDir, expected, projectRoot);
      continue;
    }

    if (fileInstallOutputDirs.has(absDir)) {
      cleanupFileInstallManifest(absDir, expected, projectRoot);
      continue;
    }

    // Stale managed dir: not a dir install, not a file install output dir.
    removeDir(absDir, projectRoot);
  }
}
