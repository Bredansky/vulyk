import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { findManifest, readManifest } from "../lib/manifest.js";
import { parseSource, fetchSource } from "../lib/fetcher.js";
import { install, uninstall, resolvePath, isManagedByVulyk } from "../lib/installer.js";
import { isEnabled } from "../lib/whitelist.js";
import { log } from "../lib/log.js";

export function syncCommand(): void {
  const manifestPath = findManifest();
  if (!manifestPath) { log.error("No vulyk.json found."); process.exit(1); }

  const manifest = readManifest(manifestPath);
  const skills = Object.entries(manifest.skills);
  if (skills.length === 0) { log.warn("No skills in vulyk.json"); return; }

  const installedNames = new Set(Object.keys(manifest.skills));

  // Remove vulyk-managed skills that are no longer in vulyk.json
  for (const targetPath of manifest.paths) {
    const resolved = resolvePath(targetPath);
    if (!fs.existsSync(resolved)) continue;
    for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
      if (entry.isDirectory() && !installedNames.has(entry.name) && isManagedByVulyk(path.join(resolved, entry.name))) {
        fs.rmSync(path.join(resolved, entry.name), { recursive: true, force: true });
        log.dim(`  removed ${entry.name} (not in vulyk.json)`);
      }
    }
  }

  for (const [name, specifier] of skills) {
    if (!isEnabled(manifest, name)) {
      uninstall(name, manifest.paths);
      log.dim(`  skipped ${name} (not in whitelist)`);
      continue;
    }

    log.info(`  syncing ${name}...`);
    const tmpDir = path.join(os.homedir(), ".vulyk", "tmp", name);
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });

    try {
      fetchSource(parseSource(specifier), tmpDir);
      install(name, tmpDir, manifest.paths);
      fs.rmSync(tmpDir, { recursive: true, force: true });
      log.success(name);
    } catch (err) {
      log.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log.success("Sync complete");
}
