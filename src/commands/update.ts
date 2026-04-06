import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { execSync } from "node:child_process";
import { findManifest, readManifest, writeManifest } from "../lib/manifest.js";
import {
  parseSource,
  fetchSource,
  type GitResolvedSource,
} from "../lib/fetcher.js";
import { install, resolvePath } from "../lib/installer.js";
import { color, log } from "../lib/log.js";
import { getRepoCachePath } from "../lib/cache.js";
import { pinSpecifier, stripPinnedRef } from "../lib/specifier.js";
import {
  isRemoteDocSource,
  resolveRuleForEntry,
  validateDocsManifest,
} from "../lib/docs.js";

function fetchLatest(repoCache: string, ref: string): string {
  try {
    if (fs.existsSync(repoCache)) {
      execSync(`git --git-dir="${repoCache}" fetch --all --tags`, {
        stdio: "pipe",
      });
    }
  } catch {
    /* use cached */
  }
  return execSync(`git --git-dir="${repoCache}" rev-parse "${ref}"`, {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}

function isGitSource(
  value: ReturnType<typeof parseSource>,
): value is GitResolvedSource {
  return value.kind === "git";
}

export async function updateCommand(name?: string): Promise<void> {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);
  const projectRoot = path.dirname(manifestPath);
  validateDocsManifest(manifest, projectRoot);

  const skills = name
    ? Object.entries(manifest.skills.entries).filter(
        ([entryName]) => entryName === name,
      )
    : Object.entries(manifest.skills.entries);
  const docs = name
    ? Object.entries(manifest.docs.entries).filter(
        ([entryName]) => entryName === name,
      )
    : Object.entries(manifest.docs.entries);

  if (skills.length === 0 && docs.length === 0) {
    log.warn(name ? `"${name}" not found` : "Nothing to update");
    return;
  }

  let updated = 0;

  if (skills.length > 0) log.print(color.dim("\nSkills:"));

  for (const [entryName, entry] of skills) {
    const resolved = parseSource(entry.source);
    const tmpDir = path.join(os.homedir(), ".vulyk", "tmp", entryName);
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    try {
      if (isGitSource(resolved)) {
        const repoCache = getRepoCachePath(resolved.repoUrl);
        const baseSpecifier = stripPinnedRef(entry.source);
        const baseResolved = parseSource(baseSpecifier);
        if (!isGitSource(baseResolved)) {
          throw new Error("Expected git source");
        }

        const latestCommit = fetchLatest(repoCache, baseResolved.ref);
        const currentCommit = /^[0-9a-f]{7,}$/.exec(resolved.ref)
          ? resolved.ref
          : null;
        if (currentCommit && latestCommit === currentCommit) {
          log.print(
            `  ${color.dim(`${entryName} already up to date (${latestCommit.slice(0, 7)})`)}`,
          );
          continue;
        }

        const prev = currentCommit?.slice(0, 7) ?? resolved.ref;
        log.print(
          `  ${color.blue(entryName)} ${color.dim(`${prev} -> ${latestCommit.slice(0, 7)}`)}`,
        );

        baseResolved.ref = latestCommit;
        await fetchSource(baseResolved, tmpDir);
        install(entryName, tmpDir, manifest.skills.outputPaths);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        manifest.skills.entries[entryName] = {
          source: pinSpecifier(baseSpecifier, latestCommit),
        };
        log.success(entryName);
        updated++;
        continue;
      }

      log.print(
        `  ${color.blue(entryName)} ${color.dim("refreshing direct URL")}`,
      );
      await fetchSource(resolved, tmpDir);
      install(entryName, tmpDir, manifest.skills.outputPaths);
      fs.rmSync(tmpDir, { recursive: true, force: true });
      log.success(entryName);
      updated++;
    } catch (err) {
      log.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (docs.length > 0) log.print(color.dim("\nDocs:"));

  for (const [entryName, entry] of docs) {
    if (!isRemoteDocSource(projectRoot, entry.source)) {
      log.print(`  ${color.dim(`${entryName} is local; nothing to update`)}`);
      continue;
    }

    const resolved = parseSource(entry.source);
    const tmpDir = path.join(os.homedir(), ".vulyk", "tmp", `doc-${entryName}`);
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    try {
      let normalizedSource = entry.source;

      if (isGitSource(resolved)) {
        const repoCache = getRepoCachePath(resolved.repoUrl);
        const baseSpecifier = stripPinnedRef(entry.source);
        const baseResolved = parseSource(baseSpecifier);
        if (!isGitSource(baseResolved)) {
          throw new Error("Expected git source");
        }

        const latestCommit = fetchLatest(repoCache, baseResolved.ref);
        const currentCommit = /^[0-9a-f]{7,}$/.exec(resolved.ref)
          ? resolved.ref
          : null;
        if (currentCommit && latestCommit === currentCommit) {
          log.print(
            `  ${color.dim(`${entryName} already up to date (${latestCommit.slice(0, 7)})`)}`,
          );
          continue;
        }

        const prev = currentCommit?.slice(0, 7) ?? resolved.ref;
        log.print(
          `  ${color.blue(entryName)} ${color.dim(`${prev} -> ${latestCommit.slice(0, 7)}`)}`,
        );

        baseResolved.ref = latestCommit;
        await fetchSource(baseResolved, tmpDir);
        normalizedSource = pinSpecifier(baseSpecifier, latestCommit);
      } else {
        log.print(
          `  ${color.blue(entryName)} ${color.dim("refreshing direct URL")}`,
        );
        await fetchSource(resolved, tmpDir);
      }

      const mdFile = fs
        .readdirSync(tmpDir)
        .find((file) => file.endsWith(".md"));
      if (!mdFile) throw new Error("No markdown file found");

      const rawBody = fs.readFileSync(path.join(tmpDir, mdFile), "utf8");
      const rule = resolveRuleForEntry(manifest, projectRoot, entry);
      for (const outputPath of rule.config.outputPaths) {
        const destDir = resolvePath(path.join(projectRoot, outputPath));
        fs.mkdirSync(destDir, { recursive: true });
        fs.writeFileSync(path.join(destDir, `${entryName}.md`), rawBody);
      }

      fs.rmSync(tmpDir, { recursive: true, force: true });
      manifest.docs.entries[entryName] = {
        ...entry,
        source: normalizedSource,
      };
      log.success(entryName);
      updated++;
    } catch (err) {
      log.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (updated > 0) writeManifest(manifestPath, manifest);
  log.print("");
  if (updated > 0) log.success(`Updated ${String(updated)} item(s)`);
}
