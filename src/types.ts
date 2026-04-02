import { z } from "zod";

export const PathsSchema = z.object({
  skills: z.array(z.string()).default([]),
  docs: z.array(z.string()).default(["docs/external"]),
});

export const DocEntrySchema = z.object({
  source: z.string(),
  targets: z.array(z.string()),
  description: z.string().optional(),
});

export const ManifestSchema = z.object({
  paths: PathsSchema.default({}),
  enabled: z.array(z.string()).optional(),
  skills: z.record(z.string(), z.string()).default({}),
  docs: z.record(z.string(), DocEntrySchema).default({}),
});

export type Paths = z.infer<typeof PathsSchema>;
export type DocEntry = z.infer<typeof DocEntrySchema>;
export type Manifest = z.infer<typeof ManifestSchema>;
