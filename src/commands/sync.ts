import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { findManifest, readManifest, writeManifest } from "../lib/manifest.js";
import { parseSource, fetchSource } from "../lib/fetcher.js";
import {
  install,
  uninstall,
  resolvePath,
  isManagedByVulyk,
} from "../lib/installer.js";
import { isEnabled } from "../lib/whitelist.js";
import {
  updateRootGitignore,
  getRootGitignoreEntries,
} from "../lib/gitignore.js";
import { log } from "../lib/log.js";
import { pinSpecifier } from "../lib/specifier.js";
import { docsCommand } from "./docs.js";

const MARKER = ".vulyk";
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

function quoteYaml(value: string): string {
  return JSON.stringify(value);
}

function buildDocFrontmatter(
  source: string,
  targets: string[],
  description?: string,
): string {
  const lines = ["---", "paths:"];
  for (const target of targets) {
    lines.push(`  - ${quoteYaml(target)}`);
  }
  if (description) {
    lines.push(`description: ${quoteYaml(description)}`);
  }
  lines.push(`source: ${quoteYaml(source)}`);
  lines.push("---", "");
  return lines.join("\n");
}

function cleanupStaleManagedSkillPaths(manifestPath: string): void {
  const manifest = readManifest(manifestPath);
  const projectRoot = path.dirname(manifestPath);
  const expectedSkillEntries = new Set(
    Object.keys(manifest.skills.entries).map(
      (name) => `${manifest.skills.path}/${name}/`,
    ),
  );

  const managedEntries = getRootGitignoreEntries();
  const staleSkillEntries = managedEntries.filter((entry) => {
    if (!entry.endsWith("/")) return false;
    if (entry.startsWith("**/")) return false;
    if (entry === `${manifest.docs.path}/`) return false;
    return !expectedSkillEntries.has(entry);
  });

  if (staleSkillEntries.length === 0) return;

  const removableEntries: string[] = [];
  for (const entry of staleSkillEntries) {
    const skillDir = path.join(projectRoot, entry.replace(/[\\/]+$/, ""));
    if (!fs.existsSync(skillDir)) {
      removableEntries.push(entry);
      continue;
    }
    if (!isManagedByVulyk(skillDir)) continue;

    fs.rmSync(skillDir, { recursive: true, force: true });
    removableEntries.push(entry);
    log.dim(`  removed ${entry} (stale managed path)`);
  }

  if (removableEntries.length === 0) return;

  updateRootGitignore(
    managedEntries.filter((entry) => !removableEntries.includes(entry)).sort(),
  );
}
function normalizeExternalDoc(
  body: string,
  source: string,
  targets: string[],
  description?: string,
): string {
  const normalizedBody = body.replace(FRONTMATTER_RE, "").trimStart();
  return `${buildDocFrontmatter(source, targets, description)}${normalizedBody}`;
}

function syncExternalDocs(manifestPath: string): void {
  const manifest = readManifest(manifestPath);
  const docEntries = Object.entries(manifest.docs.entries);
  if (docEntries.length === 0) return;

  const projectRoot = path.dirname(manifestPath);
  let changed = false;

  for (const [name, entry] of docEntries) {
    const destDir = resolvePath(path.join(projectRoot, manifest.docs.path));
    fs.mkdirSync(destDir, { recursive: true });

    const destFile = path.join(destDir, `${name}.md`);
    log.info(`  syncing doc ${name}...`);

    const tmpDir = path.join(os.homedir(), ".vulyk", "tmp", `doc-${name}`);
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    try {
      const commit = fetchSource(parseSource(entry.source), tmpDir);
      const files = fs.readdirSync(tmpDir);
      const mdFile = files.find((f) => f.endsWith(".md"));
      if (!mdFile) throw new Error("No markdown file found in fetched content");

      const rawBody = fs.readFileSync(path.join(tmpDir, mdFile), "utf8");
      const pinnedSource = pinSpecifier(entry.source, commit);
      const normalizedBody = normalizeExternalDoc(
        rawBody,
        pinnedSource,
        entry.targets,
        entry.description,
      );
      fs.writeFileSync(destFile, normalizedBody);
      fs.writeFileSync(path.join(destDir, MARKER), "");
      fs.rmSync(tmpDir, { recursive: true, force: true });

      manifest.docs.entries[name] = {
        ...entry,
        source: pinnedSource,
      };
      changed = true;

      const entries = new Set(getRootGitignoreEntries());
      entries.add(`${manifest.docs.path}/`);
      updateRootGitignore([...entries].sort());

      log.success(name);
    } catch (err) {
      log.error(
        `Failed to sync doc "${name}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (changed) writeManifest(manifestPath, manifest);
}

export function syncCommand(): void {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);
  let changed = false;
  cleanupStaleManagedSkillPaths(manifestPath);
  const skills = Object.entries(manifest.skills.entries);
  const installedNames = new Set(Object.keys(manifest.skills.entries));

  for (const targetPath of [manifest.skills.path]) {
    const resolved = resolvePath(targetPath);
    if (!fs.existsSync(resolved)) continue;
    for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        !installedNames.has(entry.name) &&
        isManagedByVulyk(path.join(resolved, entry.name))
      ) {
        fs.rmSync(path.join(resolved, entry.name), {
          recursive: true,
          force: true,
        });
        log.dim(`  removed ${entry.name} (not in vulyk.json)`);
      }
    }
  }

  for (const [name, specifier] of skills) {
    if (!isEnabled(manifest, name)) {
      uninstall(name, [manifest.skills.path]);
      log.dim(`  skipped ${name} (not in whitelist)`);
      continue;
    }

    log.info(`  syncing ${name}...`);
    const tmpDir = path.join(os.homedir(), ".vulyk", "tmp", name);
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    try {
      const commit = fetchSource(parseSource(specifier), tmpDir);
      install(name, tmpDir, [manifest.skills.path]);
      const pinnedSpecifier = pinSpecifier(specifier, commit);
      if (manifest.skills.entries[name] !== pinnedSpecifier) {
        manifest.skills.entries[name] = pinnedSpecifier;
        changed = true;
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
      log.success(name);
    } catch (err) {
      log.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (changed) writeManifest(manifestPath, manifest);

  if (Object.keys(manifest.docs.entries).length > 0) {
    log.info("\n  syncing external docs...");
    syncExternalDocs(manifestPath);
  }

  docsCommand({ also: manifest.docs.also });

  log.success("Sync complete");
}
