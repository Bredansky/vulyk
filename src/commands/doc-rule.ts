import { findManifest, readManifest, writeManifest } from "../lib/manifest.js";
import { log } from "../lib/log.js";
import type { DocRule } from "../types.js";

interface DocRuleSetOptions {
  match: string[];
  outputPaths?: string[];
  also?: string[];
  gitignoreGenerated?: boolean;
}

function normalizeList(values: string[] | undefined): string[] | undefined {
  if (!values) return undefined;
  return values.map((value) => value.replace(/\\/g, "/").replace(/[\\/]$/, ""));
}

export function docRuleSetCommand(name: string, opts: DocRuleSetOptions): void {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found. Run `vulyk init` first.");
    process.exit(1);
  }

  if (opts.match.length === 0) {
    log.error("Doc rule requires at least one --match pattern.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);
  const rule: DocRule = {
    match: normalizeList(opts.match) ?? [],
    outputPaths: normalizeList(opts.outputPaths) ?? ["docs/external"],
    also: opts.also ?? [],
    ...(opts.gitignoreGenerated === undefined
      ? {}
      : { gitignoreGenerated: opts.gitignoreGenerated }),
  };

  manifest.docs.rules[name] = rule;
  writeManifest(manifestPath, manifest);
  log.success(`Set doc rule "${name}"`);
}

export function docRuleRemoveCommand(name: string): void {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found. Run `vulyk init` first.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);
  if (!manifest.docs.rules[name]) {
    log.error(`Doc rule "${name}" not found`);
    process.exit(1);
  }

  const { [name]: _, ...remainingRules } = manifest.docs.rules;
  manifest.docs.rules = remainingRules;
  writeManifest(manifestPath, manifest);
  log.success(`Removed doc rule "${name}"`);
}
