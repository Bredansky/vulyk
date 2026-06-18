import * as fs from "node:fs";
import * as path from "node:path";
import type { Manifest, Entry, Group, DocRule } from "../types.js";

// --- Lookup helpers ---

export function getEntry(manifest: Manifest, name: string): Entry | undefined {
  return manifest.entries[name];
}

export function getGroup(
  manifest: Manifest,
  name: string | undefined,
): Group | undefined {
  if (!name) return undefined;
  return manifest.groups[name];
}

export function resolveGroupForEntry(
  manifest: Manifest,
  entryName: string,
): Group | undefined {
  const entry = getEntry(manifest, entryName);
  if (!entry) return undefined;
  return getGroup(manifest, entry.group);
}

// --- Field resolution (entry > group > manifest fallback) ---

export function resolveOutputPaths(
  manifest: Manifest,
  entryName: string,
): string[] {
  const entry = getEntry(manifest, entryName);
  if (!entry) return [];
  if (entry.outputPaths && entry.outputPaths.length > 0) {
    return entry.outputPaths;
  }
  const group = resolveGroupForEntry(manifest, entryName);
  if (group?.outputPaths && group.outputPaths.length > 0) {
    return group.outputPaths;
  }
  return manifest.outputPaths ?? [];
}

export function resolveAlso(manifest: Manifest, entryName: string): string[] {
  const entry = getEntry(manifest, entryName);
  if (!entry) return [];
  return entry.also ?? [];
}

export function resolveGitignoreGenerated(
  manifest: Manifest,
  entryName: string,
): boolean | undefined {
  const entry = getEntry(manifest, entryName);
  if (entry?.gitignoreGenerated !== undefined) return entry.gitignoreGenerated;
  const group = resolveGroupForEntry(manifest, entryName);
  if (group?.gitignoreGenerated !== undefined) return group.gitignoreGenerated;
  if (manifest.gitignoreGenerated !== undefined) {
    return manifest.gitignoreGenerated;
  }
  return undefined;
}

// --- Enable/disable logic ---
// Empty/missing whitelist = all enabled.
// `disabled` always wins over `enabled`.
// Group-level wins over manifest-level fallback.

export function isEnabled(manifest: Manifest, entryName: string): boolean {
  const entry = getEntry(manifest, entryName);
  if (!entry) return false;

  const group = resolveGroupForEntry(manifest, entryName);

  // Explicit disable wins
  const disabled = group?.disabled ?? manifest.disabled ?? [];
  if (disabled.includes(entryName)) return false;

  // Empty/missing whitelist = all enabled
  const enabled = group?.enabled ?? manifest.enabled;
  if (!enabled || enabled.length === 0) return true;

  return enabled.includes(entryName);
}

export function setEnabled(
  manifest: Manifest,
  entryName: string,
  enabled: boolean,
): void {
  const entry = getEntry(manifest, entryName);
  if (!entry) return;

  const groupName = entry.group;
  const group = groupName ? manifest.groups[groupName] : undefined;

  if (enabled) {
    // Remove from disabled (group-level if exists, else manifest-level)
    if (group?.disabled) {
      group.disabled = group.disabled.filter((n) => n !== entryName);
    } else if (group) {
      group.disabled = [];
    }
    if (manifest.disabled) {
      manifest.disabled = manifest.disabled.filter((n) => n !== entryName);
    }
  } else {
    // Add to disabled (group-level preferred)
    const target = group ?? manifest;
    target.disabled ??= [];
    if (!target.disabled.includes(entryName)) {
      target.disabled.push(entryName);
    }
  }
}

// --- Group detection (for `vulyk add` auto-classification) ---

export function groupMatchesSource(
  group: Group,
  sourcePath: string,
  sourceIsFile: boolean,
): boolean {
  const v = group.validate;
  if (!v) return false;

  // File extension check
  if (v.fileExtension) {
    if (!sourceIsFile) return false;
    if (!sourcePath.endsWith(v.fileExtension)) return false;
  }

  // mustContain: required paths/files in the source
  if (v.mustContain && v.mustContain.length > 0) {
    for (const required of v.mustContain) {
      const requiredPath = sourceIsFile
        ? path.join(path.dirname(sourcePath), required)
        : path.join(sourcePath, required);
      if (!fs.existsSync(requiredPath)) return false;
    }
  }

  return true;
}

export function detectGroup(
  manifest: Manifest,
  sourcePath: string,
  sourceIsFile: boolean,
): string | undefined {
  for (const [name, group] of Object.entries(manifest.groups)) {
    if (groupMatchesSource(group, sourcePath, sourceIsFile)) return name;
  }
  return undefined;
}

// --- Doc rule resolution (target-glob based) ---

export function resolveRuleForTarget(
  manifest: Manifest,
  target: string,
): { name: string; config: DocRule } {
  for (const [, group] of Object.entries(manifest.groups)) {
    if (!group.rules) continue;
    for (const [ruleName, rule] of Object.entries(group.rules)) {
      if (rule.match.some((pattern) => matchGlob(target, pattern))) {
        return { name: ruleName, config: rule };
      }
    }
  }
  // Default rule
  return {
    name: "__default__",
    config: {
      match: [],
      outputPaths: ["docs/external"],
      also: [],
      gitignoreGenerated: true,
    },
  };
}

export function resolveRuleForEntry(
  manifest: Manifest,
  entryName: string,
): { name: string; config: DocRule } | undefined {
  const entry = getEntry(manifest, entryName);
  if (!entry?.targets || entry.targets.length === 0) return undefined;
  const first = entry.targets[0];
  if (!first) return undefined;
  return resolveRuleForTarget(manifest, first);
}

function matchGlob(input: string, pattern: string): boolean {
  const normalizedInput = input.replace(/\\/g, "/").replace(/[\\/]$/, "");
  const normalizedPattern = pattern.replace(/\\/g, "/").replace(/[\\/]$/, "");
  if (normalizedPattern === "." || normalizedPattern === "") return true;
  if (!normalizedPattern.includes("*")) {
    return (
      normalizedInput === normalizedPattern ||
      normalizedInput.startsWith(`${normalizedPattern}/`)
    );
  }
  const base = (normalizedPattern.split("*")[0] ?? "").replace(/[\\/]$/, "");
  return normalizedInput === base || normalizedInput.startsWith(`${base}/`);
}

// --- Convenience: list entries by group ---

export function entriesByGroup(
  manifest: Manifest,
): Map<string, [string, Entry][]> {
  const map = new Map<string, [string, Entry][]>();
  for (const [name, entry] of Object.entries(manifest.entries)) {
    const key = entry.group ?? "(ungrouped)";
    const bucket = map.get(key);
    if (bucket) {
      bucket.push([name, entry]);
    } else {
      map.set(key, [[name, entry]]);
    }
  }
  return map;
}
