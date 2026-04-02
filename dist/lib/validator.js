import * as fs from "node:fs";
import * as path from "node:path";
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
function parseFrontmatter(content) {
    const match = FRONTMATTER_RE.exec(content);
    if (!match)
        return null;
    const result = {};
    for (const line of match[1].split("\n")) {
        const colonIdx = line.indexOf(":");
        if (colonIdx === -1)
            continue;
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
        if (key)
            result[key] = value;
    }
    return result;
}
export function validateSkill(skillDir) {
    const skillName = path.basename(skillDir);
    const skillFile = path.join(skillDir, "SKILL.md");
    const errors = [];
    const warnings = [];
    if (!fs.existsSync(skillFile)) {
        return {
            skillPath: skillDir,
            name: skillName,
            errors: [{ field: "SKILL.md", message: "SKILL.md not found" }],
            warnings,
        };
    }
    const content = fs.readFileSync(skillFile, "utf8");
    const frontmatter = parseFrontmatter(content);
    if (!frontmatter) {
        errors.push({ field: "frontmatter", message: "Missing YAML frontmatter" });
        return { skillPath: skillDir, name: skillName, errors, warnings };
    }
    // name
    const name = frontmatter["name"];
    if (!name) {
        errors.push({ field: "name", message: "Required field missing" });
    }
    else {
        if (name.length > 64)
            errors.push({ field: "name", message: "Must be 64 characters or fewer" });
        if (!NAME_RE.test(name))
            errors.push({ field: "name", message: "Must be lowercase alphanumeric with single hyphens, no leading/trailing hyphens" });
        if (name !== skillName)
            errors.push({ field: "name", message: `Must match directory name "${skillName}"` });
    }
    // description
    const description = frontmatter["description"];
    if (!description) {
        errors.push({ field: "description", message: "Required field missing" });
    }
    else {
        if (description.length === 0)
            errors.push({ field: "description", message: "Must not be empty" });
        if (description.length > 1024)
            errors.push({ field: "description", message: "Must be 1024 characters or fewer" });
        if (description.length < 20)
            warnings.push({ field: "description", message: "Too short — should describe what the skill does and when to use it" });
    }
    // compatibility (optional)
    const compatibility = frontmatter["compatibility"];
    if (compatibility && compatibility.length > 500) {
        errors.push({ field: "compatibility", message: "Must be 500 characters or fewer" });
    }
    // body length warning
    const body = content.replace(FRONTMATTER_RE, "").trim();
    const lineCount = body.split("\n").length;
    if (lineCount > 500) {
        warnings.push({ field: "body", message: `${String(lineCount)} lines — consider moving reference material to references/ directory (recommended max: 500)` });
    }
    return { skillPath: skillDir, name: skillName, errors, warnings };
}
export function validateDir(dir) {
    if (!fs.existsSync(dir))
        return [];
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => validateSkill(path.join(dir, e.name)));
}
