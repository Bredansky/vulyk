import * as path from "node:path";
import * as fs from "node:fs";
import { findManifest, readManifest } from "../lib/manifest.js";
import { getEntry, isEnabled, resolveAgents } from "../lib/groups.js";
import { log } from "../lib/log.js";
import { addToManifest } from "../lib/installer.js";
import { getDocSourcePath, getDocTitle } from "../lib/docs.js";
import type { Manifest } from "../types.js";

function getTargetDir(projectRoot: string, target: string): string {
  const resolved = path.resolve(projectRoot, target);
  if (target.includes("*")) {
    return path.resolve(
      projectRoot,
      (target.split("*")[0] ?? "").replace(/\/$/, ""),
    );
  }
  return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
    ? resolved
    : path.dirname(resolved);
}

/**
 * Render a primary agent file section for one entry. The section is
 * `# Title\n\ndescription\n\nFull documentation: <path>` — readable by
 * every tool (Claude Code follows the path, Codex/Hermes treat it as a
 * literal reference they can `cat` or `rg` directly).
 */
function renderPrimarySection(
  title: string,
  description: string,
  relativePath: string,
): string {
  const blocks: string[] = [];
  if (title) blocks.push(`# ${title}`);
  if (description) blocks.push(description);
  blocks.push(`Full documentation: ${relativePath}`);
  return `${blocks.join("\n\n")}\n`;
}

interface AgentContribution {
  targetDir: string;
  agentPath: string;
  agentRelativePath: string;
  body: string;
}

/**
 * Compute one entry's contribution to its primary agent file. Returns
 * an empty array when the entry has nothing to contribute (no targets,
 * no source, or empty agents list).
 */
function computePrimaryContribution(
  name: string,
  entry: Manifest["entries"][string],
  projectRoot: string,
  manifest: Manifest,
  cliOverrides: { agents?: string[] } = {},
): AgentContribution[] {
  if (!entry.targets || entry.targets.length === 0) return [];
  const docFilePath = getDocSourcePath(manifest, projectRoot, name);
  if (!docFilePath || !fs.existsSync(docFilePath)) return [];

  const docFile = getDocTitle(docFilePath, projectRoot);
  const title = docFile.title || name;
  const description = entry.description ?? "";
  const docRelativePath = docFile.relativePath;

  const agents = cliOverrides.agents ?? resolveAgents(manifest, name);
  const primaryAgent = agents[0];
  if (!primaryAgent) return [];

  const body = `${renderPrimarySection(title, description, docRelativePath)}\n`;

  return entry.targets.map((target) => {
    const targetDir = getTargetDir(projectRoot, target);
    return {
      targetDir,
      agentPath: path.join(targetDir, primaryAgent),
      agentRelativePath: primaryAgent,
      body,
    };
  });
}

/**
 * Group primary contributions by their target file path and write each
 * shared agent file as the source-order composition of its sections,
 * separated by `---`. Idempotent on exact file content.
 */
function writeComposedAgentFiles(
  contributions: AgentContribution[],
  secondaryWrites: { agentPath: string; body: string }[],
): void {
  // Group primary contributions by their target file path, preserving
  // insertion order so the output mirrors the manifest's entry order.
  const buckets = new Map<string, AgentContribution[]>();
  for (const c of contributions) {
    const list = buckets.get(c.agentPath) ?? [];
    list.push(c);
    buckets.set(c.agentPath, list);
  }

  for (const [agentPath, bucket] of buckets) {
    const targetDir = bucket[0]?.targetDir ?? path.dirname(agentPath);
    fs.mkdirSync(targetDir, { recursive: true });
    const sections = bucket.map((c) => c.body.trim());
    const desired =
      sections.length > 0 ? `${sections.join("\n\n---\n\n")}\n` : "";

    let existing = "";
    if (fs.existsSync(agentPath)) {
      existing = fs.readFileSync(agentPath, "utf8");
    }
    if (existing !== desired) {
      fs.writeFileSync(agentPath, desired);
    }
    addToManifest(targetDir, [path.basename(agentPath)]);
  }

  for (const { agentPath, body } of secondaryWrites) {
    fs.mkdirSync(path.dirname(agentPath), { recursive: true });
    fs.writeFileSync(agentPath, body);
    addToManifest(path.dirname(agentPath), [path.basename(agentPath)]);
  }
}

/**
 * Generate AGENTS.md/CLAUDE.md files for every enabled entry that has
 * `targets`. Does NOT install from sources — that's `vulyk sync`. Run
 * `vulyk sync` first, then `vulyk agents`.
 */
export function agentsCommand(
  cliOverrides: {
    agents?: string[];
  } = {},
): void {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);
  const projectRoot = path.dirname(manifestPath);

  log.blue("\nGenerating agent files:");
  const allContributions: AgentContribution[] = [];
  const allSecondaryWrites: { agentPath: string; body: string }[] = [];

  for (const name of Object.keys(manifest.entries)) {
    if (!isEnabled(manifest, name)) continue;
    const entry = getEntry(manifest, name);
    if (!entry) continue;

    const agents = cliOverrides.agents ?? resolveAgents(manifest, name);
    const primaryAgent = agents[0];
    const docFilePath = getDocSourcePath(manifest, projectRoot, name);

    const contributions = computePrimaryContribution(
      name,
      entry,
      projectRoot,
      manifest,
      cliOverrides,
    );
    allContributions.push(...contributions);

    if (
      primaryAgent &&
      docFilePath &&
      fs.existsSync(docFilePath) &&
      entry.targets
    ) {
      for (const target of entry.targets) {
        const targetDir = getTargetDir(projectRoot, target);
        for (let i = 1; i < agents.length; i++) {
          const agent = agents[i];
          if (!agent) continue;
          const agentPath = path.join(targetDir, agent);
          allSecondaryWrites.push({ agentPath, body: `@${primaryAgent}\n` });
        }
      }
    }
  }

  writeComposedAgentFiles(allContributions, allSecondaryWrites);
  log.success("\nAgents complete");
}
