import { z } from "zod";

// --- Pack mode: how to render an entry into an alias file (AGENTS.md, etc.) ---

/**
 * How a doc entry gets packed into an alias file (AGENTS.md, etc.):
 *  - `summary` (default): full section with title + description + reference
 *    link. Works for every tool that reads the alias file as plain markdown.
 *  - `import`: one-line `@<path>` reference. Claude Code expands the imported
 *    file's content into context at launch. Codex, OpenCode, and Hermes
 *    render it as literal text and do not follow it — only use this when
 *    the alias will only be read by Claude Code.
 */
export const PackModeSchema = z.enum(["summary", "import"]);

export type PackMode = z.infer<typeof PackModeSchema>;

/**
 * An alias file can be declared as a plain string (default mode for its
 * position — primary aliases default to `summary`, others to `import`) or
 * as an object with an explicit `mode` override.
 */
export const AliasSchema = z.union([
  z.string(),
  z.object({
    path: z.string(),
    mode: PackModeSchema.optional(),
  }),
]);

export type AliasSpec = z.infer<typeof AliasSchema>;

// --- Doc rule (used inside groups.rules for target-glob output routing) ---

export const DocRuleSchema = z.object({
  match: z.array(z.string()).min(1),
  outputPaths: z.array(z.string()).min(1).optional().default(["docs/external"]),
  aliases: z.array(AliasSchema).default([]),
  gitIgnore: z.boolean().optional(),
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
  gitIgnore: z.boolean().optional(),
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
  // Default alias files to generate per target dir. Entry-level `aliases`
  // overrides this list.
  aliases: z.array(AliasSchema).optional(),
  // Default pack mode for the primary alias (e.g., AGENTS.md).
  pack: PackModeSchema.optional(),
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
  // Alias files to generate per target dir (e.g., AGENTS.md, CLAUDE.md).
  // First entry is the "primary" — its mode defaults to `summary` (or the
  // entry/group `pack` override). All others default to `import` so Claude
  // Code picks them up via `@<primary>`.
  aliases: z.array(AliasSchema).optional(),
  // Per-entry gitignore override.
  gitIgnore: z.boolean().optional(),
  // Per-entry validate block. Used by `vulyk add` to auto-detect this entry's
  // own group-less classification; ignored at sync time. Lets a single entry
  // carry its full group config inline without a `groups` block.
  validate: z
    .object({
      mustContain: z.array(z.string()).optional(),
      frontmatter: z.array(z.string()).optional(),
      fileExtension: z.string().optional(),
    })
    .optional(),
  // Doc-style: which code paths this doc applies to.
  targets: z.array(z.string()).optional(),
  // Doc-style: human-readable description.
  description: z.string().optional(),
  // Per-entry pack mode override. Applies to the primary alias unless that
  // alias declares its own mode.
  pack: PackModeSchema.optional(),
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
  gitIgnore: z.boolean().optional(),
  aliases: z.array(AliasSchema).optional(),
  pack: PackModeSchema.optional(),
});

export type Manifest = z.infer<typeof ManifestSchema>;
