import { type Manifest } from "../types.js";

export function isEnabled(manifest: Manifest, name: string): boolean {
  if (!manifest.enabled || manifest.enabled.length === 0) return true;
  return manifest.enabled.includes(name);
}
