import { type Manifest } from "../types.js";

export function isEnabled(manifest: Manifest, name: string): boolean {
  if (!manifest.skills.enabled || manifest.skills.enabled.length === 0) {
    return true;
  }
  return manifest.skills.enabled.includes(name);
}
