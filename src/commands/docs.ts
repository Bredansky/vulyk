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
  description: string;
  title: string;
  relativePath: string;
}

function parseFrontmatterField(frontmatter: string, field: string): string {
  const match = new RegExp(`^${field}:\\s*(.+)$`, "m").exec(frontmatter);
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : "";
}

function parseTitle(body: string): string {
  const match = /^#\s+(.+)$/m.exec(body);
  return match ? match[1].trim() : "";
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
        const description = parseFrontmatterField(match[1], "description");
        const body = content.slice(match[0].length).trim();
        const title = parseTitle(body);
        const relativePath = path.relative(docsDir, fullPath).replace(/\\/g, "/");
        results.push({ filePath: fullPath, paths, description, title, relativePath });
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
  const byTarget = new Map<string, DocFile[]>();

  for (const doc of docs) {
    for (const targetPath of doc.paths) {
      const resolved = resolvePath(path.join(projectRoot, targetPath));
      const targetDir = resolved.includes("*")
        ? resolvePath(path.join(projectRoot, targetPath.split("*")[0].replace(/\/$/, "")))
        : fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
          ? resolved
          : path.dirname(resolved);

      if (!byTarget.has(targetDir)) byTarget.set(targetDir, []);
      byTarget.get(targetDir)!.push(doc);
    }
  }

  let generated = 0;

  for (const [targetDir, docFiles] of byTarget) {
    fs.mkdirSync(targetDir, { recursive: true });

    const sections = docFiles.map((doc) => {
      const docPath = path.relative(projectRoot, doc.filePath).replace(/\\/g, "/");
      const lines: string[] = [];
      if (doc.title) lines.push(`# ${doc.title}`);
      if (doc.description) lines.push(`\n${doc.description}`);
      lines.push(`\n@${docPath}`);
      return lines.join("");
    });

    const agentsPath = path.join(targetDir, AGENTS_FILE);
    fs.writeFileSync(agentsPath, `${sections.join("\n\n---\n\n")}\n`);

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
