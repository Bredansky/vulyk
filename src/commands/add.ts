import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { findManifest, readManifest, writeManifest } from "../lib/manifest.js";
import { parseSource, fetchSource } from "../lib/fetcher.js";
import { install } from "../lib/installer.js";
import { log } from "../lib/log.js";
import {
  pinSpecifier,
  stripPinnedRef,
  isRemoteSpecifier,
} from "../lib/specifier.js";
import {
  detectGroup,
  resolveOutputPaths,
  resolveGitignoreGenerated,
  isEnabled,
} from "../lib/groups.js";
import { readState, writeState } from "../lib/state.js";
import type { Manifest, Group } from "../types.js";

const DEFAULT_DIR_GROUP = {
  outputPaths: [".agents/skills"],
  validate: { mustContain: ["SKILL.md"] },
  gitIgnore: true,
};

const DEFAULT_FILE_GROUP = {
  outputPaths: ["docs/external"],
  validate: { fileExtension: ".md" },
  gitIgnore: true,
};

interface SourceShape {
  isFile: boolean;
  isDir: boolean;
  exists: boolean;
}

/** Read a source's shape without classifying it as skill/doc/etc. */
function inspectSource(srcPath: string): SourceShape {
  if (!fs.existsSync(srcPath)) {
    return { isFile: false, isDir: false, exists: false };
  }
  const stat = fs.statSync(srcPath);
  return { isFile: stat.isFile(), isDir: stat.isDirectory(), exists: true };
}

/** Find subdirs of a dir source that match a group's validate.mustContain. */
function findSubdirsMatching(
  dirPath: string,
  group: Group | undefined,
): string[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => {
      if (
        !group?.validate?.mustContain ||
        group.validate.mustContain.length === 0
      ) {
        // No mustContain constraint → any subdir is a candidate
        return fs.readdirSync(path.join(dirPath, name)).length > 0;
      }
      // All required files must exist in the subdir
      return group.validate.mustContain.every((req) =>
        fs.existsSync(path.join(dirPath, name, req)),
      );
    });
}

/** Pick a default group for a source that has no matching group. */
function defaultGroupFor(
  manifest: Manifest,
  shape: SourceShape,
  srcPath: string,
): string {
  if (shape.isFile) {
    if (!manifest.groups[DEFAULT_FILE_GROUP.outputPaths[0] ?? "docs"]) {
      manifest.groups.docs = { ...DEFAULT_FILE_GROUP };
      log.dim(`  created group "docs" with defaults`);
    }
    return "docs";
  }
  // Directory: prefer a group that matches; if none, create a skills group
  if (shape.isDir) {
    if (!manifest.groups.skills) {
      manifest.groups.skills = { ...DEFAULT_DIR_GROUP };
      log.dim(`  created group "skills" with defaults`);
    }
    return "skills";
  }
  throw new Error(`No matching group for source "${srcPath}".`);
}

/**
 * Build the inline entry config for a group-less entry. Mirrors the default
 * group fields the user would have written explicitly, so a single entry
 * can be self-contained without a `groups` block.
 */
function inlineEntryFor(shape: SourceShape): {
  outputPaths: string[];
  validate: { mustContain?: string[]; fileExtension?: string };
  gitIgnore: boolean;
} {
  return shape.isFile ? { ...DEFAULT_FILE_GROUP } : { ...DEFAULT_DIR_GROUP };
}

/**
 * Resolve a group for a source path, either by validate match, by hint, or
 * by auto-creating a default. Kind-agnostic — uses only the source's structure
 * and the group's `validate` block.
 *
 * Returns `undefined` when no group is needed: the manifest has no groups
 * at all, so the entry should carry its config inline. The caller is
 * responsible for filling in inline `outputPaths`/`validate`/`gitIgnore`.
 */
function resolveGroupForSource(
  manifest: Manifest,
  srcPath: string,
  shape: SourceShape,
  hint: string | undefined,
): string | undefined {
  const detected = detectGroup(manifest, srcPath, shape.isFile);
  if (detected) return detected;
  if (hint && manifest.groups[hint]) return hint;
  if (Object.keys(manifest.groups).length === 0) return undefined;
  return defaultGroupFor(manifest, shape, srcPath);
}

/**
 * Convert an absolute path to a root-relative forward-slash string used
 * for `.vulyk` entries. Throws if `abs` is outside `root` —
 * install() should never produce such paths, but if it ever does we want
 * to surface that immediately rather than silently corrupting the lock.
 */
function toRootRelative(root: string, abs: string): string {
  const rel = path.relative(root, abs);
  if (rel.startsWith("..")) {
    throw new Error(
      `install() produced a path outside the project root: ${abs}`,
    );
  }
  return rel.split(path.sep).join("/");
}

function installEntry(
  manifest: Manifest,
  entryName: string,
  srcPath: string,
  packageName: string,
  sourceIsLocal: boolean,
  accumulator: string[],
  projectRoot: string,
): string {
  const outputPaths = resolveOutputPaths(manifest, entryName);
  if (outputPaths.length === 0) {
    throw new Error(
      `Entry "${entryName}" has no outputPaths (entry, group, or manifest).`,
    );
  }
  // The manifest's gitIgnore field always wins. If unset, the
  // install function uses a per-path heuristic: gitignore managed copies
  // but leave a local source path alone when source == destination.
  const explicitGitignore = resolveGitignoreGenerated(manifest, entryName);
  const gitignore = explicitGitignore;
  // For local sources, preserve the source path from being installed-over
  // and from being added to gitignore (it'd be gitignoring a real project file).
  // Also preserve the folder shape: a local source like `sources/alpha/` with
  // a single file inside is the user's intentional layout, not a remote-blob
  // temp dir.
  const preservePaths = sourceIsLocal ? [srcPath] : undefined;
  const { installName, managedPaths } = install(
    packageName,
    srcPath,
    outputPaths,
    {
      gitignore,
      preservePaths,
    },
  );
  for (const abs of managedPaths) {
    accumulator.push(toRootRelative(projectRoot, abs));
  }
  return installName;
}

/**
 * Add a single source (file or directory) to the manifest.
 * A directory whose subdirs all match a group's validate gets expanded
 * into a collection of per-subdir entries.
 */
function addOneSource(
  specifier: string,
  sourcePath: string,
  manifest: Manifest,
  projectRoot: string,
  groupHint: string | undefined,
  sourceIsLocal: boolean,
  specifierForEntry: (subPath?: string) => string,
  accumulator: string[],
): void {
  const shape = inspectSource(sourcePath);
  if (!shape.exists) {
    log.error(`Source does not exist: ${specifier}`);
    process.exit(1);
  }

  // Try to detect a group. For a directory, also probe whether the source is
  // a collection of sub-entries — if so, the group is determined by what the
  // sub-entries would match, not by the dir itself.
  const group = resolveGroupForSource(manifest, sourcePath, shape, groupHint);
  const resolvedGroup = group ? manifest.groups[group] : undefined;

  if (shape.isDir) {
    // If the dir is empty or has no matching subdirs, treat as single entry.
    const subdirs = findSubdirsMatching(sourcePath, resolvedGroup);
    if (subdirs.length > 0) {
      log.info(
        `Found ${String(subdirs.length)} entries: ${subdirs.join(", ")}`,
      );
      for (const sub of subdirs) {
        const subPath = path.join(sourcePath, sub);
        const subGroup = resolveGroupForSource(
          manifest,
          subPath,
          { isFile: false, isDir: true, exists: true },
          groupHint,
        );
        const entryName = sub;
        const inline = subGroup
          ? undefined
          : inlineEntryFor({ isFile: false, isDir: true, exists: true });
        manifest.entries[entryName] = {
          source: sourceIsLocal
            ? path.relative(projectRoot, subPath).replace(/\\/g, "/")
            : specifierForEntry(sub),
          group: subGroup,
          ...(inline ?? {}),
        };
        installEntry(
          manifest,
          entryName,
          subPath,
          entryName,
          sourceIsLocal,
          accumulator,
          projectRoot,
        );
        log.success(
          `Added "${entryName}"${subGroup ? ` to group "${subGroup}"` : " (inline)"}`,
        );
      }
      return;
    }
  }

  // Single entry (file or single directory).
  const entryName = shape.isFile
    ? path.basename(sourcePath, path.extname(sourcePath))
    : path.basename(sourcePath);
  const inline = group ? undefined : inlineEntryFor(shape);
  manifest.entries[entryName] = {
    source: sourceIsLocal
      ? path.relative(projectRoot, sourcePath).replace(/\\/g, "/")
      : specifierForEntry(),
    group,
    ...(inline ?? {}),
  };
  const installName = installEntry(
    manifest,
    entryName,
    sourcePath,
    entryName,
    sourceIsLocal,
    accumulator,
    projectRoot,
  );
  log.success(
    `Added "${installName}"${group ? ` to group "${group}"` : " (inline)"}`,
  );
  if (!isEnabled(manifest, installName)) {
    log.dim(`  (use \`vulyk enable ${installName}\` to install on agents)`);
  }
}

async function addRemote(
  specifier: string,
  nameHint: string,
  manifest: Manifest,
  _projectRoot: string,
  groupHint: string | undefined,
  accumulator: string[],
): Promise<void> {
  log.info(`Fetching ${nameHint}...`);
  const tmpDir = path.join(os.homedir(), ".vulyk", "tmp", nameHint);
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  let commit: string | null;
  try {
    commit = await fetchSource(parseSource(specifier), tmpDir);
  } catch (err) {
    log.error(
      `Failed to fetch: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  const finalSpecifier = commit
    ? pinSpecifier(specifier, commit)
    : stripPinnedRef(specifier);

  addOneSource(
    specifier,
    tmpDir,
    manifest,
    _projectRoot,
    groupHint,
    false,
    (sub) =>
      sub ? `${stripPinnedRef(finalSpecifier)}/${sub}` : finalSpecifier,
    accumulator,
  );
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function addLocal(
  specifier: string,
  manifest: Manifest,
  projectRoot: string,
  groupHint: string | undefined,
  accumulator: string[],
): void {
  const sourcePath = path.resolve(projectRoot, specifier);
  addOneSource(
    specifier,
    sourcePath,
    manifest,
    projectRoot,
    groupHint,
    true,
    () => path.relative(projectRoot, sourcePath).replace(/\\/g, "/"),
    accumulator,
  );
}

export async function addCommand(
  specifier: string,
  opts: { name?: string; group?: string } = {},
): Promise<void> {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found. Run `vulyk init` first.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);
  const projectRoot = path.dirname(manifestPath);

  const nameHint =
    opts.name ??
    specifier.split("/").filter(Boolean).pop()?.replace(/@.*$/, "") ??
    specifier;

  // Every install `add` produces is recorded in `.vulyk`.
  // We merge the new paths with whatever `sync` / `agents` previously
  // wrote so subsequent cleanup can rely on the union of them.
  const previousState = readState(projectRoot);
  const newSyncPaths: string[] = [];

  if (!isRemoteSpecifier(specifier)) {
    addLocal(specifier, manifest, projectRoot, opts.group, newSyncPaths);
  } else {
    await addRemote(
      specifier,
      nameHint,
      manifest,
      projectRoot,
      opts.group,
      newSyncPaths,
    );
  }

  // Persist the manifest (source of INTENT) first, then the lockfile
  // (cleanup truth). The order matters: if writeManifest were to fail
  // AFTER writeState succeeded, the lockfile would be ahead of the
  // manifest and the next `vulyk sync` would treat the just-installed
  // paths as stale. By writing manifest first, a later writeState failure
  // simply leaves the next `sync` to re-record the paths (idempotent).
  writeManifest(manifestPath, manifest);

  // Preserve agentPaths from prior runs so `vulyk agents` can reconcile
  // against them; writeState sorts + normalises the arrays.
  const mergedSync = new Set([...previousState.syncPaths, ...newSyncPaths]);
  writeState(projectRoot, {
    syncPaths: [...mergedSync].sort(),
    agentPaths: previousState.agentPaths,
  });
}
