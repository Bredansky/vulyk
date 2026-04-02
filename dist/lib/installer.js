import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
export function resolvePath(p) {
    return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : path.resolve(p);
}
function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory())
            copyDir(srcPath, destPath);
        else
            fs.copyFileSync(srcPath, destPath);
    }
}
function readSkillName(srcDir) {
    const skillFile = path.join(srcDir, "SKILL.md");
    if (!fs.existsSync(skillFile))
        return null;
    const content = fs.readFileSync(skillFile, "utf8");
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
    if (!match)
        return null;
    const nameLine = match[1].split("\n").find((l) => l.trimStart().startsWith("name:"));
    return nameLine ? nameLine.split(":")[1].trim().replace(/^["']|["']$/g, "") : null;
}
const MARKER = ".vulyk";
export function install(packageName, srcDir, targetPaths) {
    const installName = readSkillName(srcDir) ?? packageName;
    for (const targetPath of targetPaths) {
        const dest = path.join(resolvePath(targetPath), installName);
        if (fs.existsSync(dest))
            fs.rmSync(dest, { recursive: true, force: true });
        copyDir(srcDir, dest);
        fs.writeFileSync(path.join(dest, MARKER), "");
    }
    return installName;
}
export function uninstall(name, targetPaths) {
    for (const targetPath of targetPaths) {
        const dest = path.join(resolvePath(targetPath), name);
        if (fs.existsSync(dest))
            fs.rmSync(dest, { recursive: true, force: true });
    }
}
export function isManagedByVulyk(skillDir) {
    return fs.existsSync(path.join(skillDir, MARKER));
}
