import * as path from "node:path";
import * as fs from "node:fs";
import { findManifest, readManifest } from "../lib/manifest.js";
import { color, log } from "../lib/log.js";
import { entriesByGroup, isEnabled } from "../lib/groups.js";

function isLocalSource(projectRoot: string, source: string): boolean {
  return fs.existsSync(path.resolve(projectRoot, source));
}

export function listCommand(): void {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);
  const projectRoot = path.dirname(manifestPath);
  const grouped = entriesByGroup(manifest);

  if (grouped.size === 0) {
    log.dim("  no entries");
    log.print("");
    return;
  }

  for (const [groupName, entries] of grouped) {
    log.blue(`\n${groupName}:`);
    if (entries.length === 0) {
      log.dim("  none");
      continue;
    }
    for (const [name, entry] of entries) {
      const enabled = isEnabled(manifest, name);
      const status = enabled ? color.green("+") : color.red("-");
      const sourceKind = isLocalSource(projectRoot, entry.source)
        ? "local"
        : "external";
      log.print(
        `  ${status} ${name} ${color.dim(sourceKind)} ${color.dim(entry.source)}`,
      );
    }
  }

  if (Object.keys(manifest.groups).length > 0) {
    log.blue("\nGroups:");
    for (const [name, group] of Object.entries(manifest.groups)) {
      const outPaths = group.outputPaths?.join(", ") ?? "(default)";
      const enabledCount = group.enabled?.length ?? 0;
      const disabledCount = group.disabled?.length ?? 0;
      const counts = `enabled:${String(enabledCount)} disabled:${String(disabledCount)}`;
      log.print(
        `  ${color.dim(name)} ${color.dim(`outputPaths: ${outPaths}`)} ${color.dim(counts)}`,
      );
    }
  }
  log.print("");
}
