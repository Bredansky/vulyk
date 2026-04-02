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
      const normalizedBody = normalizeExternalDoc(
        rawBody,
        entry.source,
        entry.targets,
        entry.description,
      );
      fs.writeFileSync(destFile, normalizedBody);
      fs.writeFileSync(path.join(destDir, MARKER), "");
      fs.rmSync(tmpDir, { recursive: true, force: true });

      const baseSpecifier = entry.source.replace(/@[0-9a-f]{7,}$/, "");
      manifest.docs.entries[name] = {
        ...entry,
        source: `${baseSpecifier}@${commit}`,
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
      fetchSource(parseSource(specifier), tmpDir);
      install(name, tmpDir, [manifest.skills.path]);
      fs.rmSync(tmpDir, { recursive: true, force: true });
      log.success(name);
    } catch (err) {
      log.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (Object.keys(manifest.docs.entries).length > 0) {
    log.info("\n  syncing external docs...");
    syncExternalDocs(manifestPath);
  }

  docsCommand({ also: manifest.docs.also });

  log.success("Sync complete");
}
