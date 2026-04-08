import type { Manifest } from "../types.js";
import { validateRemoteSkillSource } from "./source-validation.js";

export function validateSkillsManifest(manifest: Manifest): void {
  for (const [name, entry] of Object.entries(manifest.skills.entries)) {
    validateRemoteSkillSource(name, entry.source);
  }
}
