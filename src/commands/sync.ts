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

const MARKER = ".vulyk";

function syncExternalDocs(manifestPath: string): void {
  const manifest = readManifest(manifestPath);
  const docEntries = Object.entries(manifest.docs);
  if (docEntries.length === 0) return;

  const projectRoot = path.dirname(manifestPath);
  let changed = false;

  for (const [name, entry] of docEntries) {
    const docPaths = manifest.paths.docs;
    const destDir = resolvePath(
      path.join(projectRoot, docPaths[0] ?? "docs/external"),
    );
    fs.mkdirSync(destDir, { recursive: true });

    const destFile = path.join(destDir, `${name}.md`);
    log.info(`  syncing doc ${name}...`);

    const tmpDir = path.join(os.homedir(), ".vulyk", "tmp", `doc-${name}`);
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    try {
      const commit = fetchSource(parseSource(entry.source), tmpDir);

      // Find the fetched file
      const files = fs.readdirSync(tmpDir);
      const mdFile = files.find((f) => f.endsWith(".md"));
      if (!mdFile) throw new Error("No markdown file found in fetched content");

      fs.copyFileSync(path.join(tmpDir, mdFile), destFile);
      fs.writeFileSync(path.join(destDir, MARKER), "");
      fs.rmSync(tmpDir, { recursive: true, force: true });

      // Pin commit in vulyk.json
      const baseSpecifier = entry.source.replace(/@[0-9a-f]{7,}$/, "");
      manifest.docs[name] = { ...entry, source: `${baseSpecifier}@${commit}` };
      changed = true;

      // Add to root .gitignore
      const entries = new Set(getRootGitignoreEntries());
      entries.add(`${docPaths[0] ?? "docs/external"}/`);
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
  const skills = Object.entries(manifest.skills);

  const installedNames = new Set(Object.keys(manifest.skills));

  // Remove vulyk-managed skills that are no longer in vulyk.json
  for (const targetPath of manifest.paths.skills) {
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
      uninstall(name, manifest.paths.skills);
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
      install(name, tmpDir, manifest.paths.skills);
      fs.rmSync(tmpDir, { recursive: true, force: true });
      log.success(name);
    } catch (err) {
      log.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Sync external docs
  if (Object.keys(manifest.docs).length > 0) {
    log.info("\n  syncing external docs...");
    syncExternalDocs(manifestPath);
  }

  log.success("Sync complete");
}
