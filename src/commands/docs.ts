import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { findManifest } from "../lib/manifest.js";
import { log, color } from "../lib/log.js";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const AGENTS_FILE = "AGENTS.md";

interface DocFile {
  filePath: string;
  paths: string[];
  content: string;
}

function parsePaths(frontmatter: string): string[] {
  const match = /^paths:\s*\n((?:\s+-\s+.+\n?)+)/m.exec(frontmatter);
  if (!match) return [];
  return match[1]
    .split("\n")
    .map((l) => l.replace(/^\s+-\s+["']?|["']?\s*$/g, "").trim())
    .filter(Boolean);
}

function resolvePath(p: string): string {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : path.resolve(p);
}

function scanDocs(docsDir: string): DocFile[] {
  if (!fs.existsSync(docsDir)) return [];

  const results: DocFile[] = [];

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const content = fs.readFileSync(fullPath, "utf8");
        const match = FRONTMATTER_RE.exec(content);
        if (!match) continue;
        const paths = parsePaths(match[1]);
        if (paths.length === 0) continue;
        // Strip frontmatter from content
        const body = content.slice(match[0].length).trim();
        results.push({ filePath: fullPath, paths, content: body });
      }
    }
  }

  walk(docsDir);
  return results;
}

export function docsCommand(opts: { also?: string[] }): void {
  const manifestPath = findManifest();
  const projectRoot = manifestPath ? path.dirname(manifestPath) : process.cwd();
  const docsDir = path.join(projectRoot, "docs");

  const docs = scanDocs(docsDir);

  if (docs.length === 0) {
    log.warn(`No docs with "paths" frontmatter found in ${docsDir}`);
    return;
  }

  // Group docs by target directory
  const byTarget = new Map<string, string[]>();

  for (const doc of docs) {
    for (const targetPath of doc.paths) {
      const resolved = resolvePath(path.join(projectRoot, targetPath));
      // Use the directory of the path (strip glob patterns)
      const targetDir = resolved.includes("*")
        ? resolvePath(path.join(projectRoot, targetPath.split("*")[0].replace(/\/$/, "")))
        : fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
          ? resolved
          : path.dirname(resolved);

      const key = targetDir;
      if (!byTarget.has(key)) byTarget.set(key, []);
      byTarget.get(key)!.push(doc.content);
    }
  }

  let generated = 0;

  for (const [targetDir, contents] of byTarget) {
    fs.mkdirSync(targetDir, { recursive: true });

    const agentsPath = path.join(targetDir, AGENTS_FILE);
    const merged = contents.join("\n\n---\n\n");
    fs.writeFileSync(agentsPath, `${merged}\n`);

    const rel = path.relative(projectRoot, agentsPath);
    log.success(`Generated ${rel}`);
    generated++;

    // Create --also aliases
    for (const alias of opts.also ?? []) {
      const aliasPath = path.join(targetDir, alias);
      fs.writeFileSync(aliasPath, `@${AGENTS_FILE}\n`);
      log.dim(`  + ${path.relative(projectRoot, aliasPath)} → @${AGENTS_FILE}`);
    }
  }

  console.log("");
  log.success(`Generated ${String(generated)} AGENTS.md file(s)`);
}
