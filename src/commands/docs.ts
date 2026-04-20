import * as fs from "node:fs";
import * as path from "node:path";
import { findManifest, readManifest } from "../lib/manifest.js";
import {
  getRootGitignoreEntries,
  updateRootGitignore,
} from "../lib/gitignore.js";
import {
  getDocTitle,
  isRemoteDocSource,
  resolvePath,
  resolveRuleForEntry,
  type ResolvedDocRule,
  validateDocsManifest,
} from "../lib/docs.js";
import type { DocEntry } from "../types.js";
import { log } from "../lib/log.js";

const AGENTS_FILE = "AGENTS.md";
const DOC_MARKER_FILE = ".vulyk";

interface GeneratedDocBucketState {
  kind: "docs";
  files: string[];
}

interface GeneratedDoc {
  filePath: string;
  relativePath: string;
  title: string;
  description: string;
}

interface TargetBucket {
  docs: GeneratedDoc[];
  aliases: Set<string>;
  gitignoreGenerated: boolean;
}

function toRelativePosix(projectRoot: string, value: string): string {
  return path.relative(projectRoot, value).replace(/\\/g, "/");
}

function buildGeneratedDocIgnoreEntries(
  projectRoot: string,
  byTarget: Map<string, TargetBucket>,
): string[] {
  const entries = new Set<string>();
  let hasGeneratedAgents = false;
  const rootAliases = new Set<string>();
  const subtreeAliases = new Map<string, Set<string>>();

  for (const [targetDir, bucket] of byTarget) {
    if (!bucket.gitignoreGenerated) continue;
    hasGeneratedAgents = true;

    const relativeDir = toRelativePosix(projectRoot, targetDir);
    const markerEntry =
      !relativeDir || relativeDir === "."
        ? DOC_MARKER_FILE
        : `${relativeDir}/${DOC_MARKER_FILE}`;
    entries.add(markerEntry);

    if (!relativeDir || relativeDir === ".") {
      for (const alias of bucket.aliases) {
        rootAliases.add(alias);
      }
      continue;
    }

    const [topLevel] = relativeDir.split("/");
    if (!topLevel) continue;

    if (!subtreeAliases.has(topLevel)) {
      subtreeAliases.set(topLevel, new Set<string>());
    }

    const aliases = subtreeAliases.get(topLevel);
    if (!aliases) continue;
    for (const alias of bucket.aliases) {
      aliases.add(alias);
    }
  }

  if (hasGeneratedAgents) {
    entries.add(AGENTS_FILE);
  }

  for (const alias of rootAliases) {
    entries.add(alias);
  }

  for (const [topLevel, aliases] of subtreeAliases) {
    for (const alias of aliases) {
      entries.add(`${topLevel}/**/${alias}`);
    }
  }

  return [...entries];
}

function getTargetDir(projectRoot: string, target: string): string {
  const resolved = resolvePath(path.join(projectRoot, target));
  if (target.includes("*")) {
    return resolvePath(
      path.join(projectRoot, (target.split("*")[0] ?? "").replace(/\/$/, "")),
    );
  }
  return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
    ? resolved
    : path.dirname(resolved);
}

function getEntryAliases(
  entry: DocEntry,
  rule: ResolvedDocRule,
  cliAliases?: string[],
): string[] {
  return [
    ...new Set([...(entry.also ?? rule.config.also), ...(cliAliases ?? [])]),
  ];
}

function shouldGitignoreGenerated(
  entry: DocEntry,
  rule: ResolvedDocRule,
): boolean {
  return entry.gitignoreGenerated ?? rule.config.gitignoreGenerated ?? true;
}

function getDocMarkerPath(targetDir: string): string {
  return path.join(targetDir, DOC_MARKER_FILE);
}

function isGeneratedDocBucketState(
  value: unknown,
): value is GeneratedDocBucketState {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "docs" &&
    "files" in value &&
    Array.isArray(value.files) &&
    value.files.every((file) => typeof file === "string")
  );
}

function readGeneratedDocBucketState(
  targetDir: string,
): GeneratedDocBucketState | null {
  const markerPath = getDocMarkerPath(targetDir);
  if (!fs.existsSync(markerPath)) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    return isGeneratedDocBucketState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeGeneratedDocBucketState(
  targetDir: string,
  files: Iterable<string>,
): void {
  const markerPath = getDocMarkerPath(targetDir);
  const state: GeneratedDocBucketState = {
    kind: "docs",
    files: [...new Set(files)].sort(),
  };
  fs.writeFileSync(markerPath, `${JSON.stringify(state, null, 2)}\n`);
}

function collectDocManagedDirs(projectRoot: string): string[] {
  const dirs: string[] = [];

  const visit = (dir: string): void => {
    const markerState = readGeneratedDocBucketState(dir);
    if (markerState) {
      dirs.push(dir);
    }

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      visit(path.join(dir, entry.name));
    }
  };

  visit(projectRoot);
  return dirs.sort();
}

function cleanupStaleGeneratedDocs(
  projectRoot: string,
  activeTargetDirs: Iterable<string>,
): void {
  const active = new Set(
    [...activeTargetDirs].map((targetDir) =>
      path.resolve(projectRoot, targetDir),
    ),
  );

  for (const targetDir of collectDocManagedDirs(projectRoot)) {
    if (active.has(targetDir)) continue;

    const state = readGeneratedDocBucketState(targetDir);
    if (!state) continue;

    for (const file of state.files) {
      const filePath = path.join(targetDir, file);
      if (!fs.existsSync(filePath)) continue;
      fs.rmSync(filePath, { force: true });
      log.dim(`  removed ${path.relative(projectRoot, filePath)}`);
    }

    const markerPath = getDocMarkerPath(targetDir);
    if (fs.existsSync(markerPath)) {
      fs.rmSync(markerPath, { force: true });
    }
  }
}

export function docsCommand(opts: { also?: string[] }): void {
  const manifestPath = findManifest();
  const projectRoot = manifestPath ? path.dirname(manifestPath) : process.cwd();
  const manifest = manifestPath ? readManifest(manifestPath) : null;

  if (!manifest) {
    log.warn("No vulyk.json found.");
    return;
  }

  validateDocsManifest(manifest, projectRoot);
  const entries = Object.entries(manifest.docs.entries);
  const currentSkillEntries = new Set(
    Object.keys(manifest.skills.entries).flatMap((name) =>
      manifest.skills.outputPaths.map((outputPath) => `${outputPath}/${name}/`),
    ),
  );

  if (entries.length === 0) {
    cleanupStaleGeneratedDocs(projectRoot, []);
    updateRootGitignore([...currentSkillEntries].sort());
    log.warn("No docs entries configured in vulyk.json.");
    return;
  }

  const byTarget = new Map<string, TargetBucket>();
  const allKnownAliases = new Set<string>(opts.also ?? []);
  const managedExternalDocOutputPaths = new Set<string>();

  for (const [name, entry] of entries) {
    const rule = resolveRuleForEntry(manifest, projectRoot, entry);
    const sourcePath = isRemoteDocSource(projectRoot, entry.source)
      ? rule.config.outputPaths
          .map((outputPath) =>
            path.resolve(projectRoot, path.join(outputPath, `${name}.md`)),
          )
          .find((candidatePath) => fs.existsSync(candidatePath))
      : path.resolve(projectRoot, entry.source);

    if (!sourcePath || !fs.existsSync(sourcePath)) {
      throw new Error(
        `Doc source file not found for "${name}". Run \`vulyk sync\` first.`,
      );
    }

    const docFile = getDocTitle(sourcePath, projectRoot);
    const generatedDoc: GeneratedDoc = {
      filePath: sourcePath,
      relativePath: docFile.relativePath,
      title: docFile.title || name,
      description: entry.description ?? "",
    };
    const gitignoreGenerated = shouldGitignoreGenerated(entry, rule);

    if (isRemoteDocSource(projectRoot, entry.source) && gitignoreGenerated) {
      for (const outputPath of rule.config.outputPaths) {
        managedExternalDocOutputPaths.add(
          toRelativePosix(projectRoot, path.resolve(projectRoot, outputPath)),
        );
      }
    }

    for (const target of entry.targets) {
      const targetDir = getTargetDir(projectRoot, target);
      if (!byTarget.has(targetDir)) {
        byTarget.set(targetDir, {
          docs: [],
          aliases: new Set<string>(),
          gitignoreGenerated: true,
        });
      }

      const bucket = byTarget.get(targetDir);
      if (!bucket) {
        throw new Error(`Failed to initialize docs bucket for "${targetDir}".`);
      }
      if (!bucket.docs.some((doc) => doc.filePath === generatedDoc.filePath)) {
        bucket.docs.push(generatedDoc);
      }

      for (const alias of getEntryAliases(entry, rule, opts.also)) {
        bucket.aliases.add(alias);
        allKnownAliases.add(alias);
      }

      bucket.gitignoreGenerated =
        bucket.gitignoreGenerated && gitignoreGenerated;
    }
  }

  let generated = 0;
  const gitignoreEntries = new Set(
    getRootGitignoreEntries().filter((entry) => currentSkillEntries.has(entry)),
  );
  for (const externalDocOutputPath of managedExternalDocOutputPaths) {
    gitignoreEntries.add(externalDocOutputPath);
  }
  for (const entry of buildGeneratedDocIgnoreEntries(projectRoot, byTarget)) {
    gitignoreEntries.add(entry);
  }

  const activeTargetDirs = new Set<string>();
  for (const [targetDir, bucket] of byTarget) {
    fs.mkdirSync(targetDir, { recursive: true });
    activeTargetDirs.add(targetDir);

    const sections = bucket.docs.map((doc) => {
      const lines: string[] = [];
      if (doc.title) lines.push(`# ${doc.title}`);
      if (doc.description) lines.push(`\n${doc.description}`);
      lines.push(`\nFull documentation: ${doc.relativePath}`);
      return lines.join("");
    });

    const agentsPath = path.join(targetDir, AGENTS_FILE);
    fs.writeFileSync(agentsPath, `${sections.join("\n\n---\n\n")}\n`);
    log.success(`Generated ${path.relative(projectRoot, agentsPath)}`);
    generated++;

    for (const alias of allKnownAliases) {
      if (bucket.aliases.has(alias)) continue;
      const aliasPath = path.join(targetDir, alias);
      if (fs.existsSync(aliasPath)) {
        fs.rmSync(aliasPath, { force: true });
      }
    }

    const managedFiles = [AGENTS_FILE];
    for (const alias of bucket.aliases) {
      const aliasPath = path.join(targetDir, alias);
      fs.writeFileSync(aliasPath, `@${AGENTS_FILE}\n`);
      managedFiles.push(alias);
      log.dim(`  Created ${path.relative(projectRoot, aliasPath)} alias`);
    }

    writeGeneratedDocBucketState(targetDir, managedFiles);
  }

  cleanupStaleGeneratedDocs(projectRoot, activeTargetDirs);
  updateRootGitignore([...gitignoreEntries].sort());

  log.print("");
  log.success(`Generated ${String(generated)} AGENTS.md file(s)`);
}
