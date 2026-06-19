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
  resolveGitignoreGenerated,
} from "../lib/groups.js";
import { log } from "../lib/log.js";
import { pinSpecifier } from "../lib/specifier.js";
import { getDocSourcePath, getDocTitle } from "../lib/docs.js";
import { cleanupStale } from "../lib/cleanup.js";
import type { Manifest } from "../types.js";

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
  cliOverrides: { aliases?: string[] } = {},
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
  const aliases = cliOverrides.aliases ?? resolveAlso(manifest, name);
  const primaryAlias = aliases[0];
  const docFilePath = getDocSourcePath(manifest, projectRoot, name);
  if (
    primaryAlias &&
    docFilePath &&
    fs.existsSync(docFilePath) &&
    entry.targets
  ) {
    for (const target of entry.targets) {
      const targetDir = getTargetDir(projectRoot, target);
      for (let i = 1; i < aliases.length; i++) {
        const alias = aliases[i];
        if (!alias) continue;
        const aliasPath = path.join(targetDir, alias);
        secondaryWrites.push({ aliasPath, body: `@${primaryAlias}\n` });
      }
    }
  }

  return { updatedSource, contributions, secondaryWrites };
}

/**
 * Render a primary alias file section for one entry. The section is
 * `# Title\n\ndescription\n\nFull documentation: <path>` — readable by
 * every tool (Claude Code follows the path, Codex/Hermes treat it as a
 * literal reference they can `cat` or `rg` directly).
 */
function renderPrimarySection(
  title: string,
  description: string,
  relativePath: string,
): string {
  const blocks: string[] = [];
  if (title) blocks.push(`# ${title}`);
  if (description) blocks.push(description);
  blocks.push(`Full documentation: ${relativePath}`);
  return `${blocks.join("\n\n")}\n`;
}

/**
 * One entry's contribution to a primary alias file (e.g. AGENTS.md).
 * Multiple contributions to the same file are composed in source order
 * with `---` separators. Idempotent on exact file content.
 */
interface PrimaryContribution {
  targetDir: string;
  primaryPath: string;
  primaryRelativePath: string;
  body: string;
}

/**
 * Compute one entry's contribution to its primary alias file. Returns
 * an empty array when the entry has nothing to contribute (no targets,
 * no source, or empty aliases).
 */
function computePrimaryContribution(
  name: string,
  entry: Manifest["entries"][string],
  projectRoot: string,
  manifest: Manifest,
  cliOverrides: { aliases?: string[] } = {},
): PrimaryContribution[] {
  if (!entry.targets || entry.targets.length === 0) return [];
  const docFilePath = getDocSourcePath(manifest, projectRoot, name);
  if (!docFilePath || !fs.existsSync(docFilePath)) return [];

  const docFile = getDocTitle(docFilePath, projectRoot);
  const title = docFile.title || name;
  const description = entry.description ?? "";
  const docRelativePath = docFile.relativePath;

  const aliases = cliOverrides.aliases ?? resolveAlso(manifest, name);
  const primaryAlias = aliases[0];
  if (!primaryAlias) return [];

  const body = `${renderPrimarySection(title, description, docRelativePath)}\n`;

  return entry.targets.map((target) => {
    const targetDir = getTargetDir(projectRoot, target);
    return {
      targetDir,
      primaryPath: path.join(targetDir, primaryAlias),
      primaryRelativePath: primaryAlias,
      body,
    };
  });
}

/**
 * Group primary contributions by their target file path and write each
 * shared alias file as the source-order composition of its sections,
 * separated by `---`. Idempotent on exact file content.
 */
function writeComposedAliasFiles(
  contributions: PrimaryContribution[],
  secondaryWrites: { aliasPath: string; body: string }[],
): void {
  // Group primary contributions by their target file path, preserving
  // insertion order so the output mirrors the manifest's entry order.
  const buckets = new Map<string, PrimaryContribution[]>();
  for (const c of contributions) {
    const list = buckets.get(c.primaryPath) ?? [];
    list.push(c);
    buckets.set(c.primaryPath, list);
  }

  for (const [primaryPath, bucket] of buckets) {
    const targetDir = bucket[0]?.targetDir ?? path.dirname(primaryPath);
    fs.mkdirSync(targetDir, { recursive: true });
    const sections = bucket.map((c) => c.body.trim());
    const desired =
      sections.length > 0 ? `${sections.join("\n\n---\n\n")}\n` : "";

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
  cliOverrides: {
    aliases?: string[];
  } = {},
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
