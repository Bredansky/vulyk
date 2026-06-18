import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Manifest } from "../types.js";
import { findManifest, readManifest } from "./manifest.js";
import { getEntry, resolveOutputPaths } from "./groups.js";

export interface DocFile {
  filePath: string;
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

export function resolvePath(value: string): string {
  return value.startsWith("~")
    ? path.join(os.homedir(), value.slice(1))
    : path.resolve(value);
}

function normalizeRelative(projectRoot: string, value: string): string {
  return path.relative(projectRoot, value).replace(/\\/g, "/");
}

function normalizeTarget(target: string): string {
  return target.replace(/\\/g, "/").replace(/[\\/]$/, "");
}

function isLocalSource(projectRoot: string, source: string): boolean {
  return fs.existsSync(path.resolve(projectRoot, source));
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
  return matchPathPattern(normalizedFile, target);
}

function getPatternBase(pattern: string): string {
  return normalizeTarget(pattern.split("*")[0] ?? pattern);
}

function matchPathPattern(inputPath: string, pattern: string): boolean {
  const normalizedInput = normalizeTarget(inputPath);
  const normalizedPattern = normalizeTarget(pattern);

  if (normalizedPattern === "." || normalizedPattern === "") return true;

  if (normalizedPattern.includes("*")) {
    const base = getPatternBase(normalizedPattern);
    return normalizedInput === base || normalizedInput.startsWith(`${base}/`);
  }

  return (
    normalizedInput === normalizedPattern ||
    normalizedInput.startsWith(`${normalizedPattern}/`)
  );
}

function parseTitle(body: string): string {
  const match = /^# (?<title>.+)$/m.exec(body);
  return match?.groups?.title?.trim() ?? "";
}

export function getDocTitle(filePath: string, relativeTo?: string): DocFile {
  const content = fs.readFileSync(filePath, "utf8");
  return {
    filePath,
    title: parseTitle(content),
    relativePath: path
      .relative(relativeTo ?? path.dirname(filePath), filePath)
      .replace(/\\/g, "/"),
  };
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

interface MatchSortKey {
  depth: number;
  exact: boolean;
  target: string;
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
    const leftNormalized = normalizeTarget(left.split("*")[0] ?? "");
    const rightNormalized = normalizeTarget(right.split("*")[0] ?? "");
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
  return { depth, exact, target: normalizedTarget };
}

function compareMatchSortKey(left: MatchSortKey, right: MatchSortKey): number {
  if (left.depth !== right.depth) return left.depth - right.depth;
  if (left.exact !== right.exact) {
    return Number(left.exact) - Number(right.exact);
  }
  return left.target.localeCompare(right.target);
}

/**
 * Returns the file path on disk for a doc entry.
 * For local entries, returns the source path.
 * For remote entries, returns the first matching output path.
 */
export function getDocSourcePath(
  manifest: Manifest,
  projectRoot: string,
  name: string,
): string | undefined {
  const entry = getEntry(manifest, name);
  if (!entry) return undefined;
  if (isLocalSource(projectRoot, entry.source)) {
    return path.resolve(projectRoot, entry.source);
  }
  const outputPaths = resolveOutputPaths(manifest, name);
  for (const outputPath of outputPaths) {
    const base = path.resolve(projectRoot, outputPath);
    // File install: <base>/<name>.md
    const filePath = path.join(base, `${name}.md`);
    if (fs.existsSync(filePath)) return filePath;
    // Dir install (remote skills/dirs): <base>/<name>/<name>.md, or any
    // *.md inside <base>/<name>/
    const dirPath = path.join(base, name);
    const inDirNamed = path.join(dirPath, `${name}.md`);
    if (fs.existsSync(inDirNamed)) return inDirNamed;
    if (fs.existsSync(dirPath)) {
      const nested = fs
        .readdirSync(dirPath, { withFileTypes: true })
        .find((d) => d.isFile() && d.name.endsWith(".md"));
      if (nested) return path.join(dirPath, nested.name);
    }
  }
  return undefined;
}

export function findDocsForFile(filePath: string): {
  file: string;
  docs: FileDocMatch[];
} {
  const manifestPath = findManifest();
  if (!manifestPath) throw new Error("No vulyk.json found.");
  const projectRoot = path.dirname(manifestPath);
  const manifest = readManifest(manifestPath);

  const matchedDocs: { doc: FileDocMatch; sortKey: MatchSortKey }[] = [];

  for (const [name, entry] of Object.entries(manifest.entries)) {
    if (!entry.targets) continue;

    if (
      !entry.targets.some((target) =>
        matchTarget(projectRoot, filePath, target),
      )
    ) {
      continue;
    }

    const filePathForDoc = getDocSourcePath(manifest, projectRoot, name);
    const title =
      filePathForDoc && fs.existsSync(filePathForDoc)
        ? getDocTitle(filePathForDoc, projectRoot).title
        : "";

    matchedDocs.push({
      doc: {
        kind: isLocalSource(projectRoot, entry.source) ? "local" : "external",
        name: title || name,
        description: entry.description ?? "",
        targets: entry.targets,
        source: isLocalSource(projectRoot, entry.source)
          ? undefined
          : entry.source,
        relativePath: filePathForDoc
          ? normalizeRelative(projectRoot, filePathForDoc)
          : undefined,
        filePath: filePathForDoc,
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
  if (!manifestPath) throw new Error("No vulyk.json found.");
  const projectRoot = path.dirname(manifestPath);
  const manifest = readManifest(manifestPath);
  const normalizedDocPath = normalizeRelative(
    projectRoot,
    path.resolve(projectRoot, docPath),
  );

  for (const [name, entry] of Object.entries(manifest.entries)) {
    if (!entry.targets) continue;
    const filePathForDoc = getDocSourcePath(manifest, projectRoot, name);
    if (!filePathForDoc) continue;
    if (normalizeRelative(projectRoot, filePathForDoc) !== normalizedDocPath) {
      continue;
    }

    const title = getDocTitle(filePathForDoc, projectRoot).title;
    return {
      doc: normalizedDocPath,
      kind: isLocalSource(projectRoot, entry.source) ? "local" : "external",
      name: title || name,
      description: entry.description ?? "",
      source: isLocalSource(projectRoot, entry.source)
        ? undefined
        : entry.source,
      targets: entry.targets.map((target) => ({
        path: normalizeTarget(target),
        kind: getTargetKind(projectRoot, target),
      })),
    };
  }

  throw new Error(`No tracked doc found for "${docPath}".`);
}
