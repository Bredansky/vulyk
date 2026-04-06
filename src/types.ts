import { z } from "zod";

export const SkillEntrySchema = z.object({
  source: z.string(),
});

export const SkillsConfigSchema = z.object({
  outputPaths: z.array(z.string()).default(["skills"]),
  enabled: z.array(z.string()).optional(),
  entries: z.record(z.string(), SkillEntrySchema).default({}),
});

export const DocEntrySchema = z.object({
  source: z.string(),
  targets: z.array(z.string()),
  description: z.string().optional(),
  also: z.array(z.string()).optional(),
  gitignoreGenerated: z.boolean().optional(),
});

export const DocRuleSchema = z.object({
  match: z.array(z.string()).min(1),
  outputPaths: z.array(z.string()).min(1).optional().default(["docs/external"]),
  also: z.array(z.string()).default([]),
  gitignoreGenerated: z.boolean().optional(),
});

export const DocsSectionSchema = z.object({
  rules: z.record(z.string(), DocRuleSchema).default({}),
  entries: z.record(z.string(), DocEntrySchema).default({}),
});

export const ManifestSchema = z.object({
  skills: SkillsConfigSchema.default({}),
  docs: DocsSectionSchema.default({}),
});

export type SkillsConfig = z.infer<typeof SkillsConfigSchema>;
export type SkillEntry = z.infer<typeof SkillEntrySchema>;
export type DocEntry = z.infer<typeof DocEntrySchema>;
export type DocRule = z.infer<typeof DocRuleSchema>;
export type DocsSection = z.infer<typeof DocsSectionSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;
