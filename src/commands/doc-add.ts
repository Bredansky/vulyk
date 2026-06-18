import { findManifest, readManifest, writeManifest } from "../lib/manifest.js";
import { log } from "../lib/log.js";

export function docAddCommand(
  specifier: string,
  opts: { targets?: string[]; description?: string },
): void {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found. Run `vulyk init` first.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);
  const name = (
    specifier.split("/").filter(Boolean).pop()?.replace(/@.*$/, "") ?? specifier
  ).replace(/\.md$/, "");

  manifest.entries[name] = {
    type: "doc",
    source: specifier,
    targets: opts.targets ?? [],
    description: opts.description,
  };

  writeManifest(manifestPath, manifest);
  log.success(`Added "${name}"`);
}
