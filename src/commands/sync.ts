import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { findManifest, readManifest, writeManifest } from "../lib/manifest.js";
import { parseSource, fetchSource } from "../lib/fetcher.js";
import {
  install,
  uninstall,
  resolvePath,
  isManagedByVulyk,
} from "../lib/installer.js";
import { isEnabled } from "../lib/whitelist.js";
import {
  getRootGitignoreEntries,
  updateRootGitignore,
} from "../lib/gitignore.js";
import { log } from "../lib/log.js";
import { pinSpecifier } from "../lib/specifier.js";
import {
  isRemoteDocSource,
  resolveRuleForEntry,
  validateDocsManifest,
} from "../lib/docs.js";
import {
  getPreservedLocalSkillPaths,
  isLocalSkillSource,
  resolveSkillSourcePath,
  validateSkillsManifest,
} from "../lib/skills.js";
import { docsCommand } from "./docs.js";

function cleanupStaleManagedSkillPaths(manifestPath: string): void {
  const manifest = readManifest(manifestPath);
  const projectRoot = path.dirname(manifestPath);
  const expectedSkillEntries = new Set(
    Object.keys(manifest.skills.entries).flatMap((name) =>
      manifest.skills.outputPaths.map((outputPath) => `${outputPath}/${name}/`),
    ),
  );

  const managedEntries = getRootGitignoreEntries();
  const staleSkillEntries = managedEntries.filter((entry) => {
    if (!entry.endsWith("/")) return false;
    if (entry.startsWith("**/")) return false;
    const normalizedEntry = entry.replace(/\\/g, "/");
    const isSkillPath = manifest.skills.outputPaths.some((outputPath) =>
      normalizedEntry.startsWith(`${outputPath.replace(/\\/g, "/")}/`),
    );
    if (!isSkillPath) return false;
    return !expectedSkillEntries.has(entry);
  });

  if (staleSkillEntries.length === 0) return;

  const removableEntries: string[] = [];
  for (const entry of staleSkillEntries) {
    const skillDir = path.join(projectRoot, entry.replace(/[\\/]+$/, ""));
    if (!fs.existsSync(skillDir)) {
      removableEntries.push(entry);
      continue;
    }
    if (!isManagedByVulyk(skillDir)) continue;

    fs.rmSync(skillDir, { recursive: true, force: true });
    removableEntries.push(entry);
    log.dim(`  removed ${entry} (stale managed path)`);
  }

  if (removableEntries.length === 0) return;

  updateRootGitignore(
    managedEntries.filter((entry) => !removableEntries.includes(entry)).sort(),
  );
}

async function syncExternalDocs(manifestPath: string): Promise<void> {
  const manifest = readManifest(manifestPath);
  const docEntries = Object.entries(manifest.docs.entries).filter(([, entry]) =>
    isRemoteDocSource(path.dirname(manifestPath), entry.source),
  );
  if (docEntries.length === 0) return;

  const projectRoot = path.dirname(manifestPath);
  validateDocsManifest(manifest, projectRoot);
  let changed = false;

  for (const [name, entry] of docEntries) {
    log.info(`  syncing doc ${name}...`);

    const tmpDir = path.join(os.homedir(), ".vulyk", "tmp", `doc-${name}`);
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    try {
      const commit = await fetchSource(parseSource(entry.source), tmpDir);
      const mdFile = fs
        .readdirSync(tmpDir)
        .find((file) => file.endsWith(".md"));
      if (!mdFile) throw new Error("No markdown file found in fetched content");

      const rawBody = fs.readFileSync(path.join(tmpDir, mdFile), "utf8");
      const normalizedSource = commit
        ? pinSpecifier(entry.source, commit)
        : entry.source;
      const rule = resolveRuleForEntry(manifest, projectRoot, entry);

      for (const outputPath of rule.config.outputPaths) {
        const destDir = resolvePath(path.join(projectRoot, outputPath));
        fs.mkdirSync(destDir, { recursive: true });
        fs.writeFileSync(path.join(destDir, `${name}.md`), rawBody);
      }

      fs.rmSync(tmpDir, { recursive: true, force: true });
      manifest.docs.entries[name] = {
        ...entry,
        source: normalizedSource,
      };
      changed = true;
      log.success(name);
    } catch (err) {
      log.error(
        `Failed to sync doc "${name}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (changed) writeManifest(manifestPath, manifest);
}

function cleanupStaleExternalDocFiles(manifestPath: string): void {
  const manifest = readManifest(manifestPath);
  const projectRoot = path.dirname(manifestPath);
  const managedGitignoreEntries = new Set(getRootGitignoreEntries());
  const outputPathToExpectedFiles = new Map<string, Set<string>>();
  const protectedLocalDocFiles = new Set<string>();

  for (const [name, entry] of Object.entries(manifest.docs.entries)) {
    if (!isRemoteDocSource(projectRoot, entry.source)) {
      protectedLocalDocFiles.add(path.resolve(projectRoot, entry.source));
      continue;
    }

    const rule = resolveRuleForEntry(manifest, projectRoot, entry);

    for (const outputPath of rule.config.outputPaths) {
      const resolvedOutputPath = resolvePath(
        path.join(projectRoot, outputPath),
      );
      if (!outputPathToExpectedFiles.has(resolvedOutputPath)) {
        outputPathToExpectedFiles.set(resolvedOutputPath, new Set());
      }
      outputPathToExpectedFiles.get(resolvedOutputPath)?.add(`${name}.md`);
    }
  }

  const candidateOutputPaths =
    outputPathToExpectedFiles.size > 0
      ? [...outputPathToExpectedFiles.keys()]
      : [...managedGitignoreEntries]
          .filter(
            (entry) =>
              !entry.endsWith("/") &&
              !entry.endsWith(".md") &&
              entry !== "AGENTS.md" &&
              entry !== "**/.vulyk" &&
              !entry.includes("CLAUDE.md"),
          )
          .map((entry) => resolvePath(path.join(projectRoot, entry)));

  for (const outputPath of candidateOutputPaths) {
    if (!fs.existsSync(outputPath) || !fs.statSync(outputPath).isDirectory()) {
      continue;
    }

    const expectedFiles =
      outputPathToExpectedFiles.get(outputPath) ?? new Set();
    for (const entry of fs.readdirSync(outputPath, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      if (expectedFiles.has(entry.name)) continue;

      const absolutePath = path.join(outputPath, entry.name);
      if (protectedLocalDocFiles.has(absolutePath)) continue;

      fs.rmSync(absolutePath, { force: true });
      log.dim(`  removed ${path.relative(projectRoot, absolutePath)}`);
    }
  }
}

export async function syncCommand(): Promise<void> {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);
  const projectRoot = path.dirname(manifestPath);
  validateSkillsManifest(manifest, projectRoot);
  validateDocsManifest(manifest, projectRoot);
  let changed = false;
  cleanupStaleManagedSkillPaths(manifestPath);
  const skills = Object.entries(manifest.skills.entries);
  const installedNames = new Set(Object.keys(manifest.skills.entries));

  for (const outputPath of manifest.skills.outputPaths) {
    const resolved = resolvePath(outputPath);
    if (!fs.existsSync(resolved)) continue;
    for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        !installedNames.has(entry.name) &&
        isManagedByVulyk(path.join(resolved, entry.name))
      ) {
        fs.rmSync(path.join(resolved, entry.name), {
          recursive: true,
          force: true,
        });
        log.dim(`  removed ${entry.name} (not in vulyk.json)`);
      }
    }
  }

  for (const [name, entry] of skills) {
    if (!isEnabled(manifest, name)) {
      uninstall(name, manifest.skills.outputPaths, {
        preservePaths: getPreservedLocalSkillPaths(
          projectRoot,
          name,
          entry.source,
          manifest.skills.outputPaths,
        ),
      });
      log.dim(`  skipped ${name} (not in whitelist)`);
      continue;
    }

    log.info(`  syncing ${name}...`);
    if (isLocalSkillSource(projectRoot, entry.source)) {
      try {
        const sourcePath = resolveSkillSourcePath(projectRoot, entry.source);
        install(name, sourcePath, manifest.skills.outputPaths, {
          preservePaths: getPreservedLocalSkillPaths(
            projectRoot,
            name,
            entry.source,
            manifest.skills.outputPaths,
          ),
        });
        log.success(name);
      } catch (err) {
        log.error(
          `Failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      continue;
    }

    const tmpDir = path.join(os.homedir(), ".vulyk", "tmp", name);
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    try {
      const commit = await fetchSource(parseSource(entry.source), tmpDir);
      install(name, tmpDir, manifest.skills.outputPaths);
      const normalizedSource = commit
        ? pinSpecifier(entry.source, commit)
        : entry.source;
      const existingEntry = manifest.skills.entries[name];
      if (existingEntry?.source !== normalizedSource) {
        manifest.skills.entries[name] = { source: normalizedSource };
        changed = true;
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
      log.success(name);
    } catch (err) {
      log.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (changed) writeManifest(manifestPath, manifest);

  cleanupStaleExternalDocFiles(manifestPath);

  if (Object.keys(manifest.docs.entries).length > 0) {
    log.info("\n  syncing external docs...");
    await syncExternalDocs(manifestPath);
  }

  docsCommand({});
  log.success("Sync complete");
}
