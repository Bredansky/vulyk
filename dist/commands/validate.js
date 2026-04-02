import * as path from "node:path";
import * as os from "node:os";
import { findManifest, readManifest } from "../lib/manifest.js";
import { validateDir, validateSkill } from "../lib/validator.js";
import { color, log } from "../lib/log.js";
function resolvePath(p) {
    return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : path.resolve(p);
}
export function validateCommand(name) {
    const manifestPath = findManifest();
    if (!manifestPath) {
        log.error("No vulyk.json found. Run `vulyk init` first.");
        process.exit(1);
    }
    const manifest = readManifest(manifestPath);
    const skillPaths = (manifest.paths["skills"] ?? []).map(resolvePath);
    if (skillPaths.length === 0) {
        log.warn("No skill paths configured in vulyk.json");
        return;
    }
    const results = name
        ? skillPaths.map((p) => validateSkill(path.join(p, name)))
        : skillPaths.flatMap((p) => validateDir(p));
    if (results.length === 0) {
        log.warn("No skills found");
        return;
    }
    let totalErrors = 0;
    let totalWarnings = 0;
    for (const result of results) {
        const hasIssues = result.errors.length > 0 || result.warnings.length > 0;
        if (!hasIssues) {
            console.log(`  ${color.green("✓")} ${result.name}`);
            continue;
        }
        console.log(`  ${result.errors.length > 0 ? color.red("✖") : color.yellow("⚠")} ${result.name}`);
        for (const err of result.errors) {
            console.log(`      ${color.red("error")} ${color.dim(err.field + ":")} ${err.message}`);
            totalErrors++;
        }
        for (const warn of result.warnings) {
            console.log(`      ${color.yellow("warn")}  ${color.dim(warn.field + ":")} ${warn.message}`);
            totalWarnings++;
        }
    }
    console.log("");
    if (totalErrors === 0 && totalWarnings === 0) {
        log.success(`All ${String(results.length)} skills valid`);
    }
    else {
        if (totalErrors > 0)
            log.error(`${String(totalErrors)} error(s) found`);
        if (totalWarnings > 0)
            log.warn(`${String(totalWarnings)} warning(s) found`);
        if (totalErrors > 0)
            process.exit(1);
    }
}
