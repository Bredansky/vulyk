import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Manifest } from "../types.js";
import { findManifest, readManifest } from "./manifest.js";

const FRONTMATTER_RE = /^---\r?\n(?<fm>[\s\S]*?)\r?\n---/;

export interface DocFile {
  filePath: string;
  paths: string[];
  description: string;
  title: string;
  relativePath: string;
}

export interface FileDocMatch {
  kind: "local" | "external";
  name: string;
  description: string;
  targets: string[];
  relativePath?: string;
  filePath?: string;
  source?: string;
}

export interface DocTargetMatch {
  path: string;
  kind: "directory" | "file" | "glob";
}

interface MatchSortKey {
  depth: number;
  exact: boolean;
  target: string;
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
    .map((line) => line.replace(/^\s+-\s+["']?|["']?\s*$/g, "").trim())
    .filter(Boolean);
}

export function resolvePath(value: string): string {
  return value.startsWith("~")
    ? path.join(os.homedir(), value.slice(1))
    : path.resolve(value);
}

export function scanDocs(docsDir: string, relativeTo = docsDir): DocFile[] {
  if (!fs.existsSync(docsDir)) return [];

  const results: DocFile[] = [];

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "external") continue;
        walk(fullPath);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

      const content = fs.readFileSync(fullPath, "utf8");
      const match = FRONTMATTER_RE.exec(content);
      if (!match) continue;
      const frontmatter = match.groups?.fm ?? "";
      const paths = parsePaths(frontmatter);
      if (paths.length === 0) continue;

      const description = parseFrontmatterField(frontmatter, "description");
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

  walk(docsDir);
  return results;
}

export function getLocalDocsDirs(
  projectRoot: string,
  manifest?: Manifest | null,
): string[] {
  return (manifest?.docs.localPaths ?? ["docs"]).map((docsPath) =>
    path.join(projectRoot, docsPath),
  );
}

function normalizeRelative(projectRoot: string, value: string): string {
  return path.relative(projectRoot, value).replace(/\\/g, "/");
}

function normalizeTarget(target: string): string {
  return target.replace(/\\/g, "/").replace(/[\\/]$/, "");
}

function getTargetKind(
  projectRoot: string,
  target: string,
): DocTargetMatch["kind"] {
  if (target.includes("*")) return "glob";

  const resolvedTarget = path.resolve(projectRoot, target);
  if (
    fs.existsSync(resolvedTarget) &&
    fs.statSync(resolvedTarget).isDirectory()
  ) {
    return "directory";
  }

  return "file";
}

function matchTarget(
  projectRoot: string,
  filePath: string,
  target: string,
): boolean {
  const normalizedFile = normalizeRelative(
    projectRoot,
    path.resolve(projectRoot, filePath),
  );
  const wildcardBase = target.split("*")[0]?.replace(/[\\/]$/, "") ?? target;

  if (target.includes("*")) {
    const normalizedBase = wildcardBase.replace(/\\/g, "/");
    return (
      normalizedFile === normalizedBase ||
      normalizedFile.startsWith(`${normalizedBase}/`)
    );
  }

  const resolvedTarget = path.resolve(projectRoot, target);
  const normalizedTarget = normalizeRelative(projectRoot, resolvedTarget);

  if (!fs.existsSync(resolvedTarget)) {
    return (
      normalizedFile === normalizedTarget ||
      normalizedFile.startsWith(`${normalizedTarget}/`)
    );
  }

  if (fs.statSync(resolvedTarget).isDirectory()) {
    return (
      normalizedFile === normalizedTarget ||
      normalizedFile.startsWith(`${normalizedTarget}/`)
    );
  }

  return normalizedFile === normalizedTarget;
}

function getMatchSortKey(
  projectRoot: string,
  filePath: string,
  targets: string[],
): MatchSortKey {
  const normalizedFile = normalizeRelative(
    projectRoot,
    path.resolve(projectRoot, filePath),
  );

  const matchingTargets = targets.filter((target) =>
    matchTarget(projectRoot, filePath, target),
  );

  const bestTarget = matchingTargets.sort((left, right) => {
    const leftNormalized = normalizeTarget(left.split("*")[0] ?? left);
    const rightNormalized = normalizeTarget(right.split("*")[0] ?? right);
    return rightNormalized.length - leftNormalized.length;
  })[0];

  const normalizedTarget = normalizeTarget(bestTarget?.split("*")[0] ?? "");
  const resolvedTarget = path.resolve(projectRoot, bestTarget ?? "");
  const targetExists = bestTarget ? fs.existsSync(resolvedTarget) : false;
  const isDirectory = targetExists
    ? fs.statSync(resolvedTarget).isDirectory()
    : false;
  const exact =
    normalizedFile === normalizedTarget &&
    !bestTarget?.includes("*") &&
    !isDirectory;
  const depth =
    normalizedTarget === "" ? 0 : normalizedTarget.split("/").length;

  return {
    depth,
    exact,
    target: normalizedTarget,
  };
}

function compareMatchSortKey(left: MatchSortKey, right: MatchSortKey): number {
  if (left.depth !== right.depth) return left.depth - right.depth;
  if (left.exact !== right.exact) {
    return Number(left.exact) - Number(right.exact);
  }
  return left.target.localeCompare(right.target);
}

export function findDocsForFile(filePath: string): {
  file: string;
  docs: FileDocMatch[];
} {
  const manifestPath = findManifest();
  if (!manifestPath) {
    throw new Error("No vulyk.json found.");
  }

  const projectRoot = path.dirname(manifestPath);
  const manifest = readManifest(manifestPath);
  const externalDocsDirs = (
    manifest.docs.outputPaths.length > 0
      ? manifest.docs.outputPaths
      : ["docs/external"]
  ).map((docsPath) => path.join(projectRoot, docsPath));
  const matchedDocs: { doc: FileDocMatch; sortKey: MatchSortKey }[] = [];

  for (const docsDir of getLocalDocsDirs(projectRoot, manifest)) {
    for (const doc of scanDocs(docsDir, projectRoot)) {
      if (
        !doc.paths.some((target) => matchTarget(projectRoot, filePath, target))
      ) {
        continue;
      }

      matchedDocs.push({
        doc: {
          kind: "local",
          name: doc.title || doc.relativePath,
          description: doc.description,
          targets: doc.paths,
          relativePath: doc.relativePath,
          filePath: doc.filePath,
        },
        sortKey: getMatchSortKey(projectRoot, filePath, doc.paths),
      });
    }
  }

  for (const [name, entry] of Object.entries(manifest.docs.entries)) {
    if (
      !entry.targets.some((target) =>
        matchTarget(projectRoot, filePath, target),
      )
    ) {
      continue;
    }

    const syncedPath = externalDocsDirs
      .map((externalDocsDir) => path.join(externalDocsDir, `${name}.md`))
      .find((candidatePath) => fs.existsSync(candidatePath));
    matchedDocs.push({
      doc: {
        kind: "external",
        name,
        description: entry.description ?? "",
        targets: entry.targets,
        source: entry.source,
        relativePath: syncedPath
          ? normalizeRelative(projectRoot, syncedPath)
          : undefined,
        filePath: syncedPath,
      },
      sortKey: getMatchSortKey(projectRoot, filePath, entry.targets),
    });
  }

  return {
    file: normalizeRelative(projectRoot, path.resolve(projectRoot, filePath)),
    docs: matchedDocs
      .sort((left, right) => compareMatchSortKey(left.sortKey, right.sortKey))
      .map((entry) => entry.doc),
  };
}

export function findTargetsForDoc(docPath: string): {
  doc: string;
  kind: "local" | "external";
  name: string;
  description: string;
  source?: string;
  targets: DocTargetMatch[];
} {
  const manifestPath = findManifest();
  if (!manifestPath) {
    throw new Error("No vulyk.json found.");
  }

  const projectRoot = path.dirname(manifestPath);
  const manifest = readManifest(manifestPath);
  const normalizedDocPath = normalizeRelative(
    projectRoot,
    path.resolve(projectRoot, docPath),
  );
  const externalDocsDirs = (
    manifest.docs.outputPaths.length > 0
      ? manifest.docs.outputPaths
      : ["docs/external"]
  ).map((docsPath) => path.join(projectRoot, docsPath));

  for (const docsDir of getLocalDocsDirs(projectRoot, manifest)) {
    for (const doc of scanDocs(docsDir, projectRoot)) {
      if (normalizeRelative(projectRoot, doc.filePath) !== normalizedDocPath) {
        continue;
      }

      return {
        doc: normalizedDocPath,
        kind: "local",
        name: doc.title || doc.relativePath,
        description: doc.description,
        targets: doc.paths.map((target) => ({
          path: normalizeTarget(target),
          kind: getTargetKind(projectRoot, target),
        })),
      };
    }
  }

  for (const [name, entry] of Object.entries(manifest.docs.entries)) {
    const syncedPath = externalDocsDirs
      .map((externalDocsDir) => path.join(externalDocsDir, `${name}.md`))
      .find(
        (candidatePath) =>
          fs.existsSync(candidatePath) &&
          normalizeRelative(projectRoot, candidatePath) === normalizedDocPath,
      );
    if (!syncedPath) {
      continue;
    }

    return {
      doc: normalizedDocPath,
      kind: "external",
      name,
      description: entry.description ?? "",
      source: entry.source,
      targets: entry.targets.map((target) => ({
        path: normalizeTarget(target),
        kind: getTargetKind(projectRoot, target),
      })),
    };
  }

  throw new Error(`No tracked doc found for "${docPath}".`);
}
