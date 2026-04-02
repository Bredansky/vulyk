import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { findManifest, readManifest } from "../lib/manifest.js";
import {
  updateRootGitignore,
  getRootGitignoreEntries,
} from "../lib/gitignore.js";
import { log } from "../lib/log.js";

const FRONTMATTER_RE = /^---\r?\n(?<fm>[\s\S]*?)\r?\n---/;
const AGENTS_FILE = "AGENTS.md";

interface DocFile {
  filePath: string;
  paths: string[];
  description: string;
  title: string;
  relativePath: string;
}

function parseFrontmatterField(frontmatter: string, field: string): string {
  const match = new RegExp(`^${field}:\\s*(?<val>.+)$`, "m").exec(frontmatter);
  return match?.groups?.val?.trim().replace(/^["']|["']$/g, "") ?? "";
}

function parseTitle(body: string): string {
  const match = /^# (?<title>.+)$/m.exec(body);
  return match?.groups?.title?.trim() ?? "";
}

function parsePaths(frontmatter: string): string[] {
  const match = /^paths:\s*\n(?<items>(?:\s+-\s+.+\n?)+)/m.exec(frontmatter);
  if (!match) return [];
  return (match.groups?.items ?? "")
    .split("\n")
    .map((l) => l.replace(/^\s+-\s+["']?|["']?\s*$/g, "").trim())
    .filter(Boolean);
}

function resolvePath(p: string): string {
  return p.startsWith("~")
    ? path.join(os.homedir(), p.slice(1))
    : path.resolve(p);
}

function scanDocs(docsDir: string, relativeTo = docsDir): DocFile[] {
  if (!fs.existsSync(docsDir)) return [];

  const results: DocFile[] = [];

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "external") continue;
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const content = fs.readFileSync(fullPath, "utf8");
        const match = FRONTMATTER_RE.exec(content);
        if (!match) continue;
        const fm = match.groups?.fm ?? "";
        const paths = parsePaths(fm);
        if (paths.length === 0) continue;
        const description = parseFrontmatterField(fm, "description");
        const body = content.slice(match[0].length).trim();
        const title = parseTitle(body);
        const relativePath = path
          .relative(relativeTo, fullPath)
          .replace(/\\/g, "/");
        results.push({
          filePath: fullPath,
          paths,
          description,
          title,
          relativePath,
        });
      }
    }
  }

  walk(docsDir);
  return results;
}

function getTargetDir(resolved: string): string {
  return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
    ? resolved
    : path.dirname(resolved);
}

export function docsCommand(opts: { also?: string[] }): void {
  const manifestPath = findManifest();
  const projectRoot = manifestPath ? path.dirname(manifestPath) : process.cwd();
  const manifest = manifestPath ? readManifest(manifestPath) : null;
  const docsDir = path.join(projectRoot, "docs");
  const also = opts.also ?? manifest?.docs.also ?? [];

  const localDocs = scanDocs(docsDir);
  const externalDocsDir = path.join(
    projectRoot,
    manifest?.docs.path ?? "docs/external",
  );
  const externalDocs = scanDocs(externalDocsDir, docsDir);
  const docs = [...localDocs, ...externalDocs];

  if (docs.length === 0) {
    log.warn(`No docs with "paths" frontmatter found in ${docsDir}`);
    return;
  }

  const byTarget = new Map<string, DocFile[]>();

  for (const doc of docs) {
    for (const targetPath of doc.paths) {
      const resolved = resolvePath(path.join(projectRoot, targetPath));
      const targetDir = resolved.includes("*")
        ? resolvePath(
            path.join(
              projectRoot,
              (targetPath.split("*")[0] ?? "").replace(/\/$/, ""),
            ),
          )
        : getTargetDir(resolved);

      if (!byTarget.has(targetDir)) byTarget.set(targetDir, []);
      byTarget.get(targetDir)?.push(doc);
    }
  }

  let generated = 0;

  for (const [targetDir, docFiles] of byTarget) {
    fs.mkdirSync(targetDir, { recursive: true });

    const sections = docFiles.map((doc) => {
      const lines: string[] = [];
      if (doc.title) lines.push(`# ${doc.title}`);
      if (doc.description) lines.push(`\n${doc.description}`);
      lines.push(`\nFull documentation: docs/${doc.relativePath}`);
      return lines.join("");
    });

    const agentsPath = path.join(targetDir, AGENTS_FILE);
    fs.writeFileSync(agentsPath, `${sections.join("\n\n---\n\n")}\n`);

    const rel = path.relative(projectRoot, agentsPath);
    log.success(`Generated ${rel}`);
    generated++;

    for (const alias of also) {
      const aliasPath = path.join(targetDir, alias);
      fs.writeFileSync(aliasPath, `@${AGENTS_FILE}\n`);
      log.dim(`  + ${path.relative(projectRoot, aliasPath)} → @${AGENTS_FILE}`);
    }
  }

  const entries = new Set(getRootGitignoreEntries());
  entries.add(`**/${AGENTS_FILE}`);
  for (const alias of also) {
    entries.add(`**/${alias}`);
  }
  const toRemove = new Set([AGENTS_FILE, ...also]);
  const cleaned = [...entries].filter((e) => !toRemove.has(e));
  updateRootGitignore(cleaned.sort());

  log.print("");
  log.success(`Generated ${String(generated)} AGENTS.md file(s)`);
}
