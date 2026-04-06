import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { DocEntry, DocRule, Manifest } from "../types.js";
import { findManifest, readManifest } from "./manifest.js";

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

export interface ResolvedDocRule {
  name: string;
  config: DocRule;
}

const DEFAULT_DOC_RULE_NAME = "__default__";
const DEFAULT_DOC_RULE: DocRule = {
  match: [],
  outputPaths: ["docs/external"],
  also: [],
  gitignoreGenerated: true,
};

interface MatchSortKey {
  depth: number;
  exact: boolean;
  target: string;
}

function parseTitle(body: string): string {
  const match = /^# (?<title>.+)$/m.exec(body);
  return match?.groups?.title?.trim() ?? "";
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

function isLocalDocSource(projectRoot: string, source: string): boolean {
  const resolvedSource = path.resolve(projectRoot, source);
  return fs.existsSync(resolvedSource);
}

export function isRemoteDocSource(
  projectRoot: string,
  source: string,
): boolean {
  return !isLocalDocSource(projectRoot, source);
}

function getPatternBase(pattern: string): string {
  return normalizeTarget(pattern.split("*")[0] ?? pattern);
}

function matchPathPattern(inputPath: string, pattern: string): boolean {
  const normalizedInput = normalizeTarget(inputPath);
  const normalizedPattern = normalizeTarget(pattern);

  if (normalizedPattern === "." || normalizedPattern === "") {
    return true;
  }

  if (normalizedPattern.includes("*")) {
    const base = getPatternBase(normalizedPattern);
    return normalizedInput === base || normalizedInput.startsWith(`${base}/`);
  }

  return (
    normalizedInput === normalizedPattern ||
    normalizedInput.startsWith(`${normalizedPattern}/`)
  );
}

function matchRulePattern(target: string, pattern: string): boolean {
  const normalizedTarget = normalizeTarget(target);
  const normalizedPattern = normalizeTarget(pattern);

  if (normalizedPattern.includes("*")) {
    const base = getPatternBase(normalizedPattern);
    return normalizedTarget === base || normalizedTarget.startsWith(`${base}/`);
  }

  return normalizedTarget === normalizedPattern;
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

export function matchTarget(
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

export function resolveRuleForTarget(
  manifest: Manifest,
  projectRoot: string,
  target: string,
): ResolvedDocRule {
  const matches = Object.entries(manifest.docs.rules)
    .filter(([, rule]) =>
      rule.match.some((pattern) => matchRulePattern(target, pattern)),
    )
    .map(([name, config]) => ({ name, config }));

  if (matches.length === 0) {
    return {
      name: DEFAULT_DOC_RULE_NAME,
      config: DEFAULT_DOC_RULE,
    };
  }

  if (matches.length > 1) {
    throw new Error(`Multiple docs rules match target "${target}".`);
  }

  const [match] = matches;
  if (!match) {
    throw new Error(`No docs rule matches target "${target}".`);
  }
  return {
    name: match.name,
    config: {
      ...DEFAULT_DOC_RULE,
      ...match.config,
    },
  };
}

export function resolveRuleForEntry(
  manifest: Manifest,
  projectRoot: string,
  entry: DocEntry,
): ResolvedDocRule {
  const ruleNames = new Set(
    entry.targets.map(
      (target) => resolveRuleForTarget(manifest, projectRoot, target).name,
    ),
  );

  if (ruleNames.size !== 1) {
    throw new Error(
      `Doc entry targets must resolve to exactly one rule: ${entry.targets.join(", ")}`,
    );
  }

  const [firstTarget] = entry.targets;
  if (!firstTarget) {
    throw new Error("Doc entry must declare at least one target.");
  }

  return resolveRuleForTarget(manifest, projectRoot, firstTarget);
}

function getDocOutputPaths(
  manifest: Manifest,
  projectRoot: string,
  entry: DocEntry,
): string[] {
  const rule = resolveRuleForEntry(manifest, projectRoot, entry);
  return rule.config.outputPaths.map((outputPath) =>
    path.resolve(projectRoot, outputPath),
  );
}

function getDocSourceFilePath(
  manifest: Manifest,
  projectRoot: string,
  name: string,
  entry: DocEntry,
): string | undefined {
  if (!isRemoteDocSource(projectRoot, entry.source)) {
    return path.resolve(projectRoot, entry.source);
  }

  return getDocOutputPaths(manifest, projectRoot, entry)
    .map((outputPath) => path.join(outputPath, `${name}.md`))
    .find((candidatePath) => fs.existsSync(candidatePath));
}

export function validateDocsManifest(
  manifest: Manifest,
  projectRoot: string,
): void {
  if (Object.keys(manifest.docs.entries).length === 0) return;

  for (const [name, entry] of Object.entries(manifest.docs.entries)) {
    if (entry.targets.length === 0) {
      throw new Error(`Doc entry "${name}" must declare at least one target.`);
    }

    resolveRuleForEntry(manifest, projectRoot, entry);

    if (!isRemoteDocSource(projectRoot, entry.source)) {
      const sourcePath = path.resolve(projectRoot, entry.source);
      if (!sourcePath.endsWith(".md")) {
        throw new Error(
          `Local doc source for "${name}" must be a markdown file.`,
        );
      }
      if (!fs.existsSync(sourcePath)) {
        throw new Error(
          `Local doc source for "${name}" does not exist: ${entry.source}`,
        );
      }
    }
  }
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
  validateDocsManifest(manifest, projectRoot);
  const matchedDocs: { doc: FileDocMatch; sortKey: MatchSortKey }[] = [];

  for (const [name, entry] of Object.entries(manifest.docs.entries)) {
    if (
      !entry.targets.some((target) =>
        matchTarget(projectRoot, filePath, target),
      )
    ) {
      continue;
    }

    const filePathForDoc = getDocSourceFilePath(
      manifest,
      projectRoot,
      name,
      entry,
    );
    const title =
      filePathForDoc && fs.existsSync(filePathForDoc)
        ? getDocTitle(filePathForDoc, projectRoot).title
        : "";

    matchedDocs.push({
      doc: {
        kind: isRemoteDocSource(projectRoot, entry.source)
          ? "external"
          : "local",
        name: title || name,
        description: entry.description ?? "",
        targets: entry.targets,
        source: isRemoteDocSource(projectRoot, entry.source)
          ? entry.source
          : undefined,
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
  if (!manifestPath) {
    throw new Error("No vulyk.json found.");
  }

  const projectRoot = path.dirname(manifestPath);
  const manifest = readManifest(manifestPath);
  validateDocsManifest(manifest, projectRoot);
  const normalizedDocPath = normalizeRelative(
    projectRoot,
    path.resolve(projectRoot, docPath),
  );

  for (const [name, entry] of Object.entries(manifest.docs.entries)) {
    const filePathForDoc = getDocSourceFilePath(
      manifest,
      projectRoot,
      name,
      entry,
    );
    if (!filePathForDoc) continue;

    if (normalizeRelative(projectRoot, filePathForDoc) !== normalizedDocPath) {
      continue;
    }

    const title = getDocTitle(filePathForDoc, projectRoot).title;
    return {
      doc: normalizedDocPath,
      kind: isRemoteDocSource(projectRoot, entry.source) ? "external" : "local",
      name: title || name,
      description: entry.description ?? "",
      source: isRemoteDocSource(projectRoot, entry.source)
        ? entry.source
        : undefined,
      targets: entry.targets.map((target) => ({
        path: normalizeTarget(target),
        kind: getTargetKind(projectRoot, target),
      })),
    };
  }

  throw new Error(`No tracked doc found for "${docPath}".`);
}
