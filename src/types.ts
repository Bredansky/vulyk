import { z } from "zod";

// --- Agent file: a markdown file generated for a doc entry (e.g., AGENTS.md, CLAUDE.md) ---

/**
 * An agent file is just a file name. The first agent of an entry is the
 * "primary" (e.g., AGENTS.md) and gets a summary section written into it.
 * All subsequent agents are "secondary" and chain to the primary with
 * a bare `@<primaryPath>` line.
 */
export const AgentSchema = z.string();

export type AgentSpec = z.infer<typeof AgentSchema>;

// --- Doc rule (used inside groups.rules for target-glob output routing) ---

export const DocRuleSchema = z.object({
  match: z.array(z.string()).min(1),
  outputPaths: z.array(z.string()).min(1).optional().default(["docs/external"]),
  agents: z.array(AgentSchema).default([]),
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
  // `undefined` means "not opted in" — install() will not gitignore
  // anything unless the resolved value is `true`.
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
  // Default agent files to generate per target dir. Entry-level `agents`
  // overrides this list.
  agents: z.array(AgentSchema).optional(),
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
  // Agent files to generate per target dir (e.g., AGENTS.md, CLAUDE.md).
  // First entry is the "primary" — it gets a summary section. All others
  // chain to the primary with `@<primaryPath>`.
  agents: z.array(AgentSchema).optional(),
  // Per-entry gitignore override. `undefined` = inherit from group/manifest.
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
  // Default: undefined = "not opted in" (install() does not gitignore
  // unless resolved value is `true`).
  gitIgnore: z.boolean().optional(),
  agents: z.array(AgentSchema).optional(),
});

export type Manifest = z.infer<typeof ManifestSchema>;
