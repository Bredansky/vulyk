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
    Object.keys(manifest.skills.entries).flatMap((name) =>
      manifest.skills.outputPaths.map((outputPath) => `${outputPath}/${name}/`),
    ),
  );

  const managedEntries = getRootGitignoreEntries();
  const staleSkillEntries = managedEntries.filter((entry) => {
    if (!entry.endsWith("/")) return false;
    if (entry.startsWith("**/")) return false;
    if (
      manifest.docs.outputPaths.some((outputPath) => entry === `${outputPath}/`)
    ) {
      return false;
    }
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

async function syncExternalDocs(manifestPath: string): Promise<void> {
  const manifest = readManifest(manifestPath);
  const docEntries = Object.entries(manifest.docs.entries);
  if (docEntries.length === 0) return;

  const projectRoot = path.dirname(manifestPath);
  let changed = false;
  const docOutputPaths =
    manifest.docs.outputPaths.length > 0
      ? manifest.docs.outputPaths
      : ["docs/external"];

  for (const [name, entry] of docEntries) {
    log.info(`  syncing doc ${name}...`);

    const tmpDir = path.join(os.homedir(), ".vulyk", "tmp", `doc-${name}`);
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    try {
      const commit = await fetchSource(parseSource(entry.source), tmpDir);
      const files = fs.readdirSync(tmpDir);
      const mdFile = files.find((file) => file.endsWith(".md"));
      if (!mdFile) throw new Error("No markdown file found in fetched content");

      const rawBody = fs.readFileSync(path.join(tmpDir, mdFile), "utf8");
      const normalizedSource = commit
        ? pinSpecifier(entry.source, commit)
        : entry.source;
      const normalizedBody = normalizeExternalDoc(
        rawBody,
        normalizedSource,
        entry.targets,
        entry.description,
      );
      for (const outputPath of docOutputPaths) {
        const destDir = resolvePath(path.join(projectRoot, outputPath));
        fs.mkdirSync(destDir, { recursive: true });
        fs.writeFileSync(path.join(destDir, `${name}.md`), normalizedBody);
        fs.writeFileSync(path.join(destDir, MARKER), "");
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });

      manifest.docs.entries[name] = {
        ...entry,
        source: normalizedSource,
      };
      changed = true;

      const entries = new Set(getRootGitignoreEntries());
      for (const outputPath of docOutputPaths) {
        entries.add(`${outputPath}/`);
      }
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

export async function syncCommand(): Promise<void> {
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

  for (const outputPath of manifest.skills.outputPaths) {
    const resolved = resolvePath(outputPath);
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

  for (const [name, entry] of skills) {
    if (!isEnabled(manifest, name)) {
      uninstall(name, manifest.skills.outputPaths);
      log.dim(`  skipped ${name} (not in whitelist)`);
      continue;
    }

    log.info(`  syncing ${name}...`);
    const tmpDir = path.join(os.homedir(), ".vulyk", "tmp", name);
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    try {
      const commit = await fetchSource(parseSource(entry.source), tmpDir);
      install(name, tmpDir, manifest.skills.outputPaths);
      const normalizedSource = commit
        ? pinSpecifier(entry.source, commit)
        : entry.source;
      const existingEntry = manifest.skills.entries[name];
      if (existingEntry?.source !== normalizedSource) {
        manifest.skills.entries[name] = { source: normalizedSource };
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
    await syncExternalDocs(manifestPath);
  }

  docsCommand({ also: manifest.docs.also });

  log.success("Sync complete");
}
