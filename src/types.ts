import { z } from "zod";

export const ManifestSchema = z.object({
  paths: z.array(z.string()).default([]),
  enabled: z.array(z.string()).optional(),
  skills: z.record(z.string(), z.string()).default({}),
});

export type Manifest = z.infer<typeof ManifestSchema>;
