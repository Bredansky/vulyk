import { z } from "zod";

export const SkillEntrySchema = z.object({
  type: z.literal("skill"),
  source: z.string(),
});

export const DocEntrySchema = z.object({
  type: z.literal("doc"),
  source: z.string(),
  targets: z.array(z.string()),
  description: z.string().optional(),
  also: z.array(z.string()).optional(),
  gitignoreGenerated: z.boolean().optional(),
});

export const UnifiedEntrySchema = z.discriminatedUnion("type", [
  SkillEntrySchema,
  DocEntrySchema,
]);

export const DocRuleSchema = z.object({
  match: z.array(z.string()).min(1),
  outputPaths: z.array(z.string()).min(1).optional().default(["docs/external"]),
  also: z.array(z.string()).default([]),
  gitignoreGenerated: z.boolean().optional(),
});

export const ManifestSchema = z.object({
  entries: z.record(z.string(), UnifiedEntrySchema).default({}),
  skillOutputPaths: z.array(z.string()).default([".agents/skills"]),
  enabled: z.array(z.string()).optional(),
  docRules: z.record(z.string(), DocRuleSchema).default({}),
});

export type SkillEntry = z.infer<typeof SkillEntrySchema>;
export type DocEntry = z.infer<typeof DocEntrySchema>;
export type UnifiedEntry = z.infer<typeof UnifiedEntrySchema>;
export type DocRule = z.infer<typeof DocRuleSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;
