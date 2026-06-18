import { z } from "zod";

// --- Doc rule (used inside groups.rules for target-glob output routing) ---

export const DocRuleSchema = z.object({
  match: z.array(z.string()).min(1),
  outputPaths: z.array(z.string()).min(1).optional().default(["docs/external"]),
  also: z.array(z.string()).default([]),
  gitignoreGenerated: z.boolean().optional(),
});

export type DocRule = z.infer<typeof DocRuleSchema>;

// --- Group: a named bundle of install behavior + validation ---

export const GroupSchema = z.object({
  // Where entries in this group install to.
  outputPaths: z.array(z.string()).optional(),
  // Whitelist; empty/missing = all enabled.
  enabled: z.array(z.string()).optional(),
  // Explicit opt-out; beats `enabled`.
  disabled: z.array(z.string()).optional(),
  // Whether installed files should be added to .gitignore.
  gitignoreGenerated: z.boolean().optional(),
  // Validation rules — used by `vulyk add` to auto-detect group.
  validate: z
    .object({
      mustContain: z.array(z.string()).optional(),
      frontmatter: z.array(z.string()).optional(),
      fileExtension: z.string().optional(),
    })
    .optional(),
  // Doc-style fallback rules (resolved by entry.targets glob match).
  rules: z.record(z.string(), DocRuleSchema).optional(),
});

export type Group = z.infer<typeof GroupSchema>;

// --- Entry: a single tracked source, references a group ---

export const EntrySchema = z.object({
  // Where to fetch from (local path or remote URL).
  source: z.string(),
  // Optional group reference. Resolved via validate.mustContain if missing.
  group: z.string().optional(),
  // Per-entry output path override (group-level used otherwise).
  outputPaths: z.array(z.string()).optional(),
  // Per-entry alias override (e.g., extra AGENTS.md/CLAUDE.md files).
  also: z.array(z.string()).optional(),
  // Per-entry gitignore override.
  gitignoreGenerated: z.boolean().optional(),
  // Doc-style: which code paths this doc applies to.
  targets: z.array(z.string()).optional(),
  // Doc-style: human-readable description.
  description: z.string().optional(),
});

export type Entry = z.infer<typeof EntrySchema>;

// --- Manifest: groups + entries + top-level fallbacks ---

export const ManifestSchema = z.object({
  groups: z.record(z.string(), GroupSchema).default({}),
  entries: z.record(z.string(), EntrySchema).default({}),

  // Top-level fallbacks (used when per-group config is absent).
  outputPaths: z.array(z.string()).optional(),
  enabled: z.array(z.string()).optional(),
  disabled: z.array(z.string()).optional(),
  gitignoreGenerated: z.boolean().optional(),
});

export type Manifest = z.infer<typeof ManifestSchema>;
