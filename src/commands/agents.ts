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

async function syncEntry(
  name: string,
  projectRoot: string,
  manifest: Manifest,
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
      generateAgentsForEntry(name, entry, projectRoot, manifest);
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
  generateAgentsForEntry(name, entry, projectRoot, manifest);
  return {};
}

/**
 * Generate or update the AGENTS.md for a single entry's targets.
 * Adds the AGENTS.md to the target dir's `.vulyk` manifest so cleanup
 * leaves any user-added files in that dir alone.
 */
function generateAgentsForEntry(
  name: string,
  entry: Manifest["entries"][string],
  projectRoot: string,
  manifest: Manifest,
): void {
  if (!entry.targets || entry.targets.length === 0) return;
  const docFilePath = getDocSourcePath(manifest, projectRoot, name);
  if (!docFilePath || !fs.existsSync(docFilePath)) return;

  const docFile = getDocTitle(docFilePath, projectRoot);
  const title = docFile.title || name;
  const description = entry.description ?? "";
  const relativePath = docFile.relativePath;
  const aliases = resolveAlso(manifest, name);

  const sectionLines: string[] = [];
  if (title) sectionLines.push(`# ${title}`);
  if (description) sectionLines.push(`\n${description}`);
  sectionLines.push(`\nFull documentation: ${relativePath}`);
  const section = sectionLines.join("");

  for (const target of entry.targets) {
    const targetDir = getTargetDir(projectRoot, target);
    fs.mkdirSync(targetDir, { recursive: true });
    const agentsPath = path.join(targetDir, "AGENTS.md");

    // Read existing AGENTS.md to append our section instead of overwriting
    let existing = "";
    if (fs.existsSync(agentsPath)) {
      existing = fs.readFileSync(agentsPath, "utf8");
    }

    // Idempotency: if the section is already present, skip
    const sectionHeader = `# ${title}`;
    if (existing.includes(sectionHeader)) continue;

    const updated = existing
      ? `${existing.replace(/\s*$/, "")}\n\n---\n\n${section}\n`
      : `${section}\n`;
    fs.writeFileSync(agentsPath, updated);
    addToManifest(targetDir, ["AGENTS.md"]);

    // Aliases
    for (const alias of aliases) {
      const aliasPath = path.join(targetDir, alias);
      fs.writeFileSync(aliasPath, `@AGENTS.md\n`);
      addToManifest(targetDir, [alias]);
    }
  }
}

/**
 * Sync every enabled entry: install from source, generate AGENTS.md if
 * the entry declares targets, refresh gitignore, prune stale managed files.
 */
export async function agentsCommand(): Promise<void> {
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
    const { updatedSource } = await syncEntry(name, projectRoot, manifest);
    if (updatedSource && updatedSource !== entry.source) {
      manifest.entries[name] = { ...entry, source: updatedSource };
      changed = true;
    }
  }

  if (changed) writeManifest(manifestPath, manifest);
  log.success("\nSync complete");
}
