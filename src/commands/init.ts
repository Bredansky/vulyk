import * as path from "node:path";
import * as fs from "node:fs";
import { MANIFEST_FILE, initManifest } from "../lib/manifest.js";
import { log } from "../lib/log.js";

export function initCommand(): void {
  const filePath = path.join(process.cwd(), MANIFEST_FILE);

  if (fs.existsSync(filePath)) {
    log.warn(`${MANIFEST_FILE} already exists`);
    return;
  }

  initManifest(filePath);
  log.success(`Created ${MANIFEST_FILE}`);
  log.dim(`  Add skill paths: "paths": { "skills": [".claude/skills"] }`);
}
