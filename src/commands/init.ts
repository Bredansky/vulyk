import * as path from "node:path";
import * as fs from "node:fs";
import { CONFIG_FILE, initManifest } from "../lib/manifest.js";
import { log } from "../lib/log.js";

export function initCommand(): void {
  const filePath = path.join(process.cwd(), CONFIG_FILE);

  if (fs.existsSync(filePath)) {
    log.warn(`${CONFIG_FILE} already exists`);
    return;
  }

  initManifest(filePath);
  log.success(`Created ${CONFIG_FILE}`);
  log.dim(`  Add a skill: vulyk add <github-url>`);
  log.dim(`  Add a doc:   vulyk add <github-url-to-markdown>`);
  log.dim(`  See: vulyk.config.ts for groups and entries`);
}
