import { z } from "zod";

export const SkillsConfigSchema = z.object({
  path: z.string().default("skills"),
  enabled: z.array(z.string()).optional(),
  entries: z.record(z.string(), z.string()).default({}),
});

export const DocEntrySchema = z.object({
  source: z.string(),
  targets: z.array(z.string()),
  description: z.string().optional(),
});

export const DocsSectionSchema = z.object({
  path: z.string().default("docs/external"),
  also: z.array(z.string()).default([]),
  entries: z.record(z.string(), DocEntrySchema).default({}),
});

export const ManifestSchema = z.object({
  skills: SkillsConfigSchema.default({}),
  docs: DocsSectionSchema.default({}),
});

export type SkillsConfig = z.infer<typeof SkillsConfigSchema>;
export type DocEntry = z.infer<typeof DocEntrySchema>;
export type DocsSection = z.infer<typeof DocsSectionSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;
