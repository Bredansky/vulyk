import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { findManifest, readManifest, writeManifest } from "../lib/manifest.js";
import { parseSource, fetchSource } from "../lib/fetcher.js";
import {
  install,
  uninstall,
  resolvePath,
  addToManifest,
} from "../lib/installer.js";
import {
  getEntry,
  isEnabled,
  resolveOutputPaths,
  resolveAlso,
  resolvePack,
  resolveGitignoreGenerated,
} from "../lib/groups.js";
import { log } from "../lib/log.js";
import { pinSpecifier } from "../lib/specifier.js";
import { getDocSourcePath, getDocTitle } from "../lib/docs.js";
import { cleanupStale } from "../lib/cleanup.js";
import type { AliasSpec, Manifest, PackMode } from "../types.js";

function isLocalSource(projectRoot: string, source: string): boolean {
  return fs.existsSync(path.resolve(projectRoot, source));
}

function getTargetDir(projectRoot: string, target: string): string {
  const resolved = resolvePath(path.join(projectRoot, target));
  if (target.includes("*")) {
    return resolvePath(
      path.join(projectRoot, (target.split("*")[0] ?? "").replace(/\/$/, "")),
    );
  }
  return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
    ? resolved
    : path.dirname(resolved);
}

interface SyncResult {
  updatedSource?: string;
  contributions: PrimaryContribution[];
  secondaryWrites: { aliasPath: string; body: string }[];
}

async function syncEntry(
  name: string,
  projectRoot: string,
  manifest: Manifest,
  cliOverrides: { pack?: PackMode; aliases?: string[] } = {},
): Promise<SyncResult> {
  const entry = getEntry(manifest, name);
  if (!entry) return { contributions: [], secondaryWrites: [] };

  if (!isEnabled(manifest, name)) {
    const outPaths = resolveOutputPaths(manifest, name);
    const isLocal = isLocalSource(projectRoot, entry.source);
    const sourceIsDir = isLocal
      ? fs.statSync(path.resolve(projectRoot, entry.source)).isDirectory()
      : true;
    uninstall(name, outPaths, { isDir: sourceIsDir });
    // The entry's contribution to the shared alias file will be
    // dropped on the next compose pass — see writeComposedAliasFiles.
    // We don't touch the file here so we don't wipe other entries'
    // contributions.
    log.dim(`  skipped ${name} (disabled)`);
    return { contributions: [], secondaryWrites: [] };
  }

  const outPaths = resolveOutputPaths(manifest, name);
  const explicitGitignore = resolveGitignoreGenerated(manifest, name);
  // undefined → install function uses per-path heuristic
  const gitignore = explicitGitignore;
  const sourceIsLocal = isLocalSource(projectRoot, entry.source);

  let updatedSource: string | undefined;

  if (sourceIsLocal) {
    const sourcePath = path.resolve(projectRoot, entry.source);
    install(name, sourcePath, outPaths, {
      gitignore,
      preservePaths: [sourcePath],
    });
  } else {
    const tmpDir = path.join(os.homedir(), ".vulyk", "tmp", name);
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    try {
      const commit = await fetchSource(parseSource(entry.source), tmpDir);
      install(name, tmpDir, outPaths, { gitignore });
      fs.rmSync(tmpDir, { recursive: true, force: true });
      updatedSource = commit
        ? pinSpecifier(entry.source, commit)
        : entry.source;
      if (updatedSource !== entry.source) {
        manifest.entries[name] = { ...entry, source: updatedSource };
      }
    } catch (err) {
      log.error(
        `Failed to sync "${name}": ${err instanceof Error ? err.message : String(err)}`,
      );
      return { contributions: [], secondaryWrites: [] };
    }
  }

  log.success(name);

  // Compute this entry's primary + secondary alias contributions.
  // The shared alias file is composed once at the end of the run.
  const contributions = computePrimaryContribution(
    name,
    entry,
    projectRoot,
    manifest,
    cliOverrides,
  );

  const secondaryWrites: { aliasPath: string; body: string }[] = [];
  const docFilePath = getDocSourcePath(manifest, projectRoot, name);
  if (docFilePath && fs.existsSync(docFilePath) && entry.targets) {
    const docFile = getDocTitle(docFilePath, projectRoot);
    const title = docFile.title || name;
    const description = entry.description ?? "";
    const docRelativePath = docFile.relativePath;
    const rawAliases = cliOverrides.aliases ?? resolveAlso(manifest, name);
    if (rawAliases.length > 0) {
      const defaultPack: PackMode =
        cliOverrides.pack ?? resolvePack(manifest, name) ?? "summary";
      const aliases = rawAliases.map((spec, i) =>
        normalizeAlias(spec, i === 0, defaultPack),
      );
      const primary = aliases[0];
      if (primary) {
        for (const target of entry.targets) {
          const targetDir = getTargetDir(projectRoot, target);
          for (let i = 1; i < aliases.length; i++) {
            const alias = aliases[i];
            if (!alias) continue;
            const aliasPath = path.join(targetDir, alias.path);
            const body = renderAliasBody(
              alias.mode,
              false,
              primary.path,
              docRelativePath,
              title,
              description,
            );
            secondaryWrites.push({ aliasPath, body });
          }
        }
      }
    }
  }

  return { updatedSource, contributions, secondaryWrites };
}

/**
 * Render the body of the primary alias file (e.g., AGENTS.md). This is the
 * canonical, full-content form. Other alias files are derived from it via
 * `renderAliasBody` below.
 */
function renderSummaryBody(
  title: string,
  description: string,
  relativePath: string,
): string {
  const lines: string[] = [];
  if (title) lines.push(`# ${title}`);
  if (description) lines.push(`\n${description}`);
  lines.push(`\nFull documentation: ${relativePath}`);
  return lines.join("");
}

/**
 * Render a single alias file's content based on its pack mode.
 *
 *  - `summary` → full section (default for the primary alias)
 *  - `import`  → `@<path>` one-liner. For non-primary aliases the path is
 *    the primary alias path (Claude Code chains imports). For a primary
 *    alias that opts into `import` mode, the path is the doc itself
 *    (no chaining — there's nothing to chain from).
 */
function renderAliasBody(
  mode: PackMode,
  isPrimary: boolean,
  primaryRelativePath: string,
  docRelativePath: string,
  title: string,
  description: string,
): string {
  if (mode === "import") {
    // Per Claude Code's @-import convention, direct imports must be bare
    // lines (no header, no description) so they sit at the top of the
    // shared AGENTS.md without a section frame. Non-primary aliases
    // chain through the primary; primary aliases import the doc itself.
    const target = isPrimary ? docRelativePath : primaryRelativePath;
    return `@${target}\n`;
  }
  if (!isPrimary) {
    throw new Error("`summary` mode is not valid for non-primary aliases");
  }
  return `${renderSummaryBody(title, description, docRelativePath)}\n`;
}

/**
 * Normalize an AliasSpec into `{ path, mode }` form.
 */
function normalizeAlias(
  spec: AliasSpec,
  isPrimary: boolean,
  defaultMode: PackMode,
): { path: string; mode: PackMode } {
  if (typeof spec === "string") {
    return { path: spec, mode: isPrimary ? defaultMode : "import" };
  }
  return {
    path: spec.path,
    mode: spec.mode ?? (isPrimary ? defaultMode : "import"),
  };
}

/**
 * One entry's contribution to a primary alias file (e.g. AGENTS.md).
 * Multiple contributions to the same file are composed in two blocks:
 * import-mode lines first (bare `@<path>`), then summary-mode sections,
 * separated by `---`.
 */
interface PrimaryContribution {
  targetDir: string;
  primaryPath: string;
  primaryRelativePath: string;
  mode: PackMode;
  body: string;
}

/**
 * Compute one entry's contribution to its primary alias file. Returns
 * null when the entry has nothing to contribute (no targets, no source,
 * or empty aliases).
 */
function computePrimaryContribution(
  name: string,
  entry: Manifest["entries"][string],
  projectRoot: string,
  manifest: Manifest,
  cliOverrides: { pack?: PackMode; aliases?: string[] } = {},
): PrimaryContribution[] {
  if (!entry.targets || entry.targets.length === 0) return [];
  const docFilePath = getDocSourcePath(manifest, projectRoot, name);
  if (!docFilePath || !fs.existsSync(docFilePath)) return [];

  const docFile = getDocTitle(docFilePath, projectRoot);
  const title = docFile.title || name;
  const description = entry.description ?? "";
  const docRelativePath = docFile.relativePath;

  const rawAliases = cliOverrides.aliases ?? resolveAlso(manifest, name);
  if (rawAliases.length === 0) return [];

  const defaultPack: PackMode =
    cliOverrides.pack ?? resolvePack(manifest, name) ?? "summary";
  const aliases = rawAliases.map((spec, i) =>
    normalizeAlias(spec, i === 0, defaultPack),
  );
  const primary = aliases[0];
  if (!primary) return [];

  const body = renderAliasBody(
    primary.mode,
    true,
    primary.path,
    docRelativePath,
    title,
    description,
  );

  return entry.targets.map((target) => {
    const targetDir = getTargetDir(projectRoot, target);
    return {
      targetDir,
      primaryPath: path.join(targetDir, primary.path),
      primaryRelativePath: primary.path,
      mode: primary.mode,
      body,
    };
  });
}

/**
 * Group contributions by (targetDir, primaryPath) and write each shared
 * alias file: import-mode lines at the top, then summary-mode sections
 * separated by `---`. The write is idempotent on exact file content.
 */
function writeComposedAliasFiles(
  contributions: PrimaryContribution[],
  secondaryWrites: { aliasPath: string; body: string }[],
): void {
  // Group primary contributions by their target file path.
  const buckets = new Map<string, PrimaryContribution[]>();
  for (const c of contributions) {
    const list = buckets.get(c.primaryPath) ?? [];
    list.push(c);
    buckets.set(c.primaryPath, list);
  }

  for (const [primaryPath, bucket] of buckets) {
    const targetDir = bucket[0]?.targetDir ?? path.dirname(primaryPath);
    fs.mkdirSync(targetDir, { recursive: true });
    const imports = bucket
      .filter((c) => c.mode === "import")
      .map((c) => c.body.trim());
    const summaries = bucket
      .filter((c) => c.mode === "summary")
      .map((c) => c.body.trim());

    const blocks: string[] = [];
    if (imports.length > 0) blocks.push(imports.join("\n"));
    if (summaries.length > 0) blocks.push(summaries.join("\n\n---\n\n"));
    const desired = blocks.length > 0 ? `${blocks.join("\n\n---\n\n")}\n` : "";

    let existing = "";
    if (fs.existsSync(primaryPath)) {
      existing = fs.readFileSync(primaryPath, "utf8");
    }
    if (existing !== desired) {
      fs.writeFileSync(primaryPath, desired);
    }
    addToManifest(targetDir, [path.basename(primaryPath)]);
  }

  for (const { aliasPath, body } of secondaryWrites) {
    fs.mkdirSync(path.dirname(aliasPath), { recursive: true });
    fs.writeFileSync(aliasPath, body);
    addToManifest(path.dirname(aliasPath), [path.basename(aliasPath)]);
  }
}

/**
 * Sync every enabled entry: install from source, generate AGENTS.md if
 * the entry declares targets, refresh gitignore, prune stale managed files.
 */
export async function agentsCommand(
  cliOverrides: { pack?: PackMode; aliases?: string[] } = {},
): Promise<void> {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);
  const projectRoot = path.dirname(manifestPath);

  cleanupStale(manifest, projectRoot);

  log.blue("\nSyncing entries:");
  let changed = false;
  const allContributions: PrimaryContribution[] = [];
  const allSecondaryWrites: { aliasPath: string; body: string }[] = [];

  for (const name of Object.keys(manifest.entries)) {
    const entry = getEntry(manifest, name);
    if (!entry) continue;
    const { updatedSource, contributions, secondaryWrites } = await syncEntry(
      name,
      projectRoot,
      manifest,
      cliOverrides,
    );
    if (updatedSource && updatedSource !== entry.source) {
      manifest.entries[name] = { ...entry, source: updatedSource };
      changed = true;
    }
    allContributions.push(...contributions);
    allSecondaryWrites.push(...secondaryWrites);
  }

  writeComposedAliasFiles(allContributions, allSecondaryWrites);

  if (changed) writeManifest(manifestPath, manifest);
  log.success("\nSync complete");
}
