import * as fs from "node:fs";
import * as path from "node:path";

export type DetectedType = "skill" | "collection";

export interface Detection {
  type: DetectedType;
  // For collections: list of subdirectory names that contain SKILL.md
  skills?: string[];
}

export function detect(srcDir: string): Detection {
  if (fs.existsSync(path.join(srcDir, "SKILL.md"))) {
    return { type: "skill" };
  }

  // Traverse children — find all subdirs with SKILL.md (including dotfile dirs like .curated)
  const skills = fs
    .readdirSync(srcDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => fs.existsSync(path.join(srcDir, e.name, "SKILL.md")))
    .map((e) => e.name);

  return { type: "collection", skills };
}
