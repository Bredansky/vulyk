import { findManifest, readManifest, writeManifest } from "../lib/manifest.js";
import { log } from "../lib/log.js";

interface DocAddOptions {
  targets: string[];
  description?: string;
}

export function docAddCommand(specifier: string, opts: DocAddOptions): void {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found. Run `vulyk init` first.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);

  if (opts.targets.length === 0) {
    log.warn(
      "No targets specified. Use --targets to specify where this doc applies.",
    );
    log.dim(
      `  Example: vulyk doc-add nicobailon/visual-explainer/docs/usage.md --targets "src"`,
    );
    process.exit(1);
  }

  const name =
    specifier
      .split("/")
      .filter(Boolean)
      .pop()
      ?.replace(/\.md$/, "")
      .replace(/@.*$/, "") ?? specifier;

  manifest.docs.entries[name] = {
    source: specifier,
    targets: opts.targets,
    ...(opts.description ? { description: opts.description } : {}),
  };

  writeManifest(manifestPath, manifest);
  log.success(`Added external doc "${name}" — run \`vulyk sync\` to fetch it`);
}
