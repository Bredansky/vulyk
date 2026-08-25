import type { Manifest } from "./types.js";

/** The configuration object accepted by Vulyk. */
export type VulykConfig = Manifest;

/** Define a Vulyk configuration with editor IntelliSense and type checking. */
export function defineConfig(config: VulykConfig): VulykConfig {
  return config;
}
