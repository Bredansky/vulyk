import * as fs from "node:fs";
import * as path from "node:path";
import { findManifest, readManifest } from "../lib/manifest.js";
import {
  updateRootGitignore,
  getRootGitignoreEntries,
} from "../lib/gitignore.js";
import {
  getLocalDocsDirs,
  resolvePath,
  scanDocs,
  type DocFile,
} from "../lib/docs.js";
import { log } from "../lib/log.js";

const AGENTS_FILE = "AGENTS.md";

function getTargetDir(resolved: string): string {
  return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
    ? resolved
    : path.dirname(resolved);
}

export function docsCommand(opts: { also?: string[] }): void {
  const manifestPath = findManifest();
  const projectRoot = manifestPath ? path.dirname(manifestPath) : process.cwd();
  const manifest = manifestPath ? readManifest(manifestPath) : null;
  const also = opts.also ?? manifest?.docs.also ?? [];

  const localDocs = getLocalDocsDirs(projectRoot, manifest).flatMap((docsDir) =>
    scanDocs(docsDir, projectRoot),
  );
  const externalDocsDir = path.join(
    projectRoot,
    manifest?.docs.outputPaths[0] ?? "docs/external",
  );
  const externalDocs = scanDocs(externalDocsDir, projectRoot);
  const docs = [...localDocs, ...externalDocs];

  if (docs.length === 0) {
    const localPaths = getLocalDocsDirs(projectRoot, manifest)
      .map((docsDir) => path.relative(projectRoot, docsDir))
      .join(", ");
    log.warn(`No docs with "paths" frontmatter found in ${localPaths}`);
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
      lines.push(`\nFull documentation: ${doc.relativePath}`);
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
