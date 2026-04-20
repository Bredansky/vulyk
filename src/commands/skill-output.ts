import { findManifest, readManifest, writeManifest } from "../lib/manifest.js";
import { log } from "../lib/log.js";

function normalizeOutputPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/[\\/]$/, "") || ".";
}

export function skillOutputAddCommand(outputPath: string): void {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found. Run `vulyk init` first.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);
  const normalizedOutputPath = normalizeOutputPath(outputPath);
  const outputPaths = new Set(manifest.skills.outputPaths);
  outputPaths.add(normalizedOutputPath);
  manifest.skills.outputPaths = [...outputPaths];
  writeManifest(manifestPath, manifest);
  log.success(`Added skill output "${normalizedOutputPath}"`);
}

export function skillOutputRemoveCommand(outputPath: string): void {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found. Run `vulyk init` first.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);
  const normalizedOutputPath = normalizeOutputPath(outputPath);
  if (!manifest.skills.outputPaths.includes(normalizedOutputPath)) {
    log.error(`Skill output "${normalizedOutputPath}" not found`);
    process.exit(1);
  }

  manifest.skills.outputPaths = manifest.skills.outputPaths.filter(
    (value) => value !== normalizedOutputPath,
  );
  writeManifest(manifestPath, manifest);
  log.success(`Removed skill output "${normalizedOutputPath}"`);
}
