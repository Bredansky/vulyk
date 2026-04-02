import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { findManifest, readManifest, writeManifest } from "../lib/manifest.js";
import { install, uninstall } from "../lib/installer.js";
import { parseSource, fetchSource } from "../lib/fetcher.js";
import { log } from "../lib/log.js";

export function enableCommand(name: string): void {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);
  if (!manifest.skills.entries[name]) {
    log.error(`"${name}" not found`);
    process.exit(1);
  }

  if (!manifest.skills.enabled) {
    log.warn(
      `No whitelist defined — all skills already enabled. Add "skills.enabled": [] to use a whitelist.`,
    );
    return;
  }

  if (!manifest.skills.enabled.includes(name)) {
    manifest.skills.enabled.push(name);
    writeManifest(manifestPath, manifest);
  }

  const tmpDir = path.join(os.homedir(), ".vulyk", "tmp", name);
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  fetchSource(parseSource(manifest.skills.entries[name]), tmpDir);
  install(name, tmpDir, [manifest.skills.path]);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  log.success(`Enabled "${name}"`);
}

export function disableCommand(name: string): void {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);
  if (!manifest.skills.entries[name]) {
    log.error(`"${name}" not found`);
    process.exit(1);
  }

  manifest.skills.enabled = manifest.skills.enabled
    ? manifest.skills.enabled.filter((n) => n !== name)
    : Object.keys(manifest.skills.entries).filter((n) => n !== name);

  writeManifest(manifestPath, manifest);
  uninstall(name, [manifest.skills.path]);
  log.success(`Disabled "${name}"`);
}
