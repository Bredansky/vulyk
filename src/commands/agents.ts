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

async function syncEntry(
  name: string,
  projectRoot: string,
  manifest: Manifest,
  cliOverrides: { pack?: PackMode; aliases?: string[] } = {},
): Promise<{ updatedSource?: string }> {
  const entry = getEntry(manifest, name);
  if (!entry) return {};

  if (!isEnabled(manifest, name)) {
    const outPaths = resolveOutputPaths(manifest, name);
    const isLocal = isLocalSource(projectRoot, entry.source);
    const sourceIsDir = isLocal
      ? fs.statSync(path.resolve(projectRoot, entry.source)).isDirectory()
      : true;
    uninstall(name, outPaths, { isDir: sourceIsDir });
    // Also drop the AGENTS.md for this entry's targets
    if (entry.targets) {
      for (const target of entry.targets) {
        const targetDir = getTargetDir(projectRoot, target);
        if (fs.existsSync(path.join(targetDir, "AGENTS.md"))) {
          fs.rmSync(path.join(targetDir, "AGENTS.md"), { force: true });
        }
      }
    }
    log.dim(`  skipped ${name} (disabled)`);
    return {};
  }

  const outPaths = resolveOutputPaths(manifest, name);
  const explicitGitignore = resolveGitignoreGenerated(manifest, name);
  // undefined → install function uses per-path heuristic
  const gitignore = explicitGitignore;
  const sourceIsLocal = isLocalSource(projectRoot, entry.source);

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
      const updatedSource = commit
        ? pinSpecifier(entry.source, commit)
        : entry.source;
      log.success(name);
      // Continue to AGENTS.md generation
      generateAgentsForEntry(name, entry, projectRoot, manifest, cliOverrides);
      return {
        updatedSource:
          updatedSource === entry.source ? undefined : updatedSource,
      };
    } catch (err) {
      log.error(
        `Failed to sync "${name}": ${err instanceof Error ? err.message : String(err)}`,
      );
      return {};
    }
  }

  log.success(name);
  generateAgentsForEntry(name, entry, projectRoot, manifest, cliOverrides);
  return {};
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
    // Primary with import: import the doc directly. Non-primary: chain via
    // the primary alias so Claude Code expands once.
    const target = isPrimary ? docRelativePath : primaryRelativePath;
    return `@${target}\n`;
  }
  // mode === "summary" — full section (only valid for the primary alias).
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
 * Generate or update the AGENTS.md for a single entry's targets.
 * Adds the generated alias files to the target dir's `.vulyk` manifest so
 * cleanup leaves any user-added files in that dir alone.
 */
function generateAgentsForEntry(
  name: string,
  entry: Manifest["entries"][string],
  projectRoot: string,
  manifest: Manifest,
  cliOverrides: { pack?: PackMode; aliases?: string[] } = {},
): void {
  if (!entry.targets || entry.targets.length === 0) return;
  const docFilePath = getDocSourcePath(manifest, projectRoot, name);
  if (!docFilePath || !fs.existsSync(docFilePath)) return;

  const docFile = getDocTitle(docFilePath, projectRoot);
  const title = docFile.title || name;
  const description = entry.description ?? "";
  const docRelativePath = docFile.relativePath;

  // Resolve aliases: CLI flag > entry.aliases > group.aliases > manifest.aliases
  const rawAliases = cliOverrides.aliases ?? resolveAlso(manifest, name);
  if (rawAliases.length === 0) return;

  // Resolve pack: CLI flag > entry.pack > group.pack > manifest.pack > "summary"
  const defaultPack: PackMode =
    cliOverrides.pack ?? resolvePack(manifest, name) ?? "summary";
  const aliases = rawAliases.map((spec, i) =>
    normalizeAlias(spec, i === 0, defaultPack),
  );

  const primary = aliases[0];
  if (!primary) return;

  for (const target of entry.targets) {
    const targetDir = getTargetDir(projectRoot, target);
    fs.mkdirSync(targetDir, { recursive: true });

    // 1. Write the primary alias (or append to it if it already has user content).
    const primaryPath = path.join(targetDir, primary.path);
    const primaryContent = renderAliasBody(
      primary.mode,
      true,
      primary.path,
      docRelativePath,
      title,
      description,
    );

    if (primary.mode === "summary") {
      // Append our section to any existing content (idempotent).
      let existing = "";
      if (fs.existsSync(primaryPath)) {
        existing = fs.readFileSync(primaryPath, "utf8");
      }
      const sectionHeader = `# ${title}`;
      if (existing.includes(sectionHeader)) {
        // Section already present; skip to keep idempotent.
      } else {
        const updated = existing
          ? `${existing.replace(/\s*$/, "")}\n\n---\n\n${primaryContent}`
          : primaryContent;
        fs.writeFileSync(primaryPath, updated);
      }
    } else {
      // reference/copy on primary: just write (we don't append to a non-summary primary)
      fs.writeFileSync(primaryPath, primaryContent);
    }
    addToManifest(targetDir, [primary.path]);

    // 2. Write the secondary aliases. Their content depends on the primary.
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
      fs.writeFileSync(aliasPath, body);
      addToManifest(targetDir, [alias.path]);
    }
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

  for (const name of Object.keys(manifest.entries)) {
    const entry = getEntry(manifest, name);
    if (!entry) continue;
    const { updatedSource } = await syncEntry(
      name,
      projectRoot,
      manifest,
      cliOverrides,
    );
    if (updatedSource && updatedSource !== entry.source) {
      manifest.entries[name] = { ...entry, source: updatedSource };
      changed = true;
    }
  }

  if (changed) writeManifest(manifestPath, manifest);
  log.success("\nSync complete");
}
