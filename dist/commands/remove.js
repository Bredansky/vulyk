import { findManifest, readManifest, writeManifest } from "../lib/manifest.js";
import { uninstall } from "../lib/installer.js";
import { log } from "../lib/log.js";
export function removeCommand(name) {
    const manifestPath = findManifest();
    if (!manifestPath) {
        log.error("No vulyk.json found.");
        process.exit(1);
    }
    const manifest = readManifest(manifestPath);
    if (!manifest.skills[name]) {
        log.error(`"${name}" not found`);
        process.exit(1);
    }
    uninstall(name, manifest.paths);
    delete manifest.skills[name];
    writeManifest(manifestPath, manifest);
    log.success(`Removed "${name}"`);
}
