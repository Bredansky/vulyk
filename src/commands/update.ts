import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { execSync } from "node:child_process";
import { findManifest, readManifest, writeManifest } from "../lib/manifest.js";
import { parseSource, fetchSource } from "../lib/fetcher.js";
import { install, resolvePath } from "../lib/installer.js";
import { color, log } from "../lib/log.js";

const MARKER = ".vulyk";

function getRepoCache(repoUrl: string): string {
  return path.join(os.homedir(), ".vulyk", "cache", Buffer.from(repoUrl).toString("base64url").slice(0, 32));
}

export function updateCommand(name?: string): void {
  const manifestPath = findManifest();
  if (!manifestPath) { log.error("No vulyk.json found."); process.exit(1); }

  const manifest = readManifest(manifestPath);

  const skillsToUpdate = name
    ? Object.entries(manifest.skills).filter(([n]) => n === name)
    : Object.entries(manifest.skills);

  const docsToUpdate = name
    ? Object.entries(manifest.docs).filter(([n]) => n === name)
    : Object.entries(manifest.docs);

  if (skillsToUpdate.length === 0 && docsToUpdate.length === 0) {
    log.warn(name ? `"${name}" not found` : "Nothing to update");
    return;
  }

  let updated = 0;
  let upToDate = 0;

  // Update skills
  for (const [n, specifier] of skillsToUpdate) {
    const resolved = parseSource(specifier);
    const repoCache = getRepoCache(resolved.repoUrl);
    const baseSpecifier = specifier.replace(/@[0-9a-f]{7,}$/, "");
    const baseResolved = parseSource(baseSpecifier);

    try {
      if (fs.existsSync(repoCache)) {
        execSync(`git --git-dir="${repoCache}" fetch --all --tags`, { stdio: "pipe" });
      }
    } catch { /* use cached */ }

    let latestCommit: string;
    try {
      latestCommit = execSync(
        `git --git-dir="${repoCache}" rev-parse "${baseResolved.ref}"`,
        { encoding: "utf8", stdio: "pipe" }
      ).trim();
    } catch {
      log.error(`Could not resolve ref for "${n}"`);
      continue;
    }

    const currentCommit = resolved.ref.match(/^[0-9a-f]{7,}$/) ? resolved.ref : null;
    if (currentCommit && latestCommit.startsWith(currentCommit)) {
      console.log(`  ${color.dim(`${n} already up to date (${latestCommit.slice(0, 7)})`)}`);
      upToDate++;
      continue;
    }

    const prev = currentCommit?.slice(0, 7) ?? resolved.ref;
    console.log(`  updating ${n} ${color.dim(`${prev} → ${latestCommit.slice(0, 7)}`)}...`);

    const tmpDir = path.join(os.homedir(), ".vulyk", "tmp", n);
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });

    try {
      baseResolved.ref = latestCommit;
      fetchSource(baseResolved, tmpDir);
      install(n, tmpDir, manifest.paths.skills);
      fs.rmSync(tmpDir, { recursive: true, force: true });
      manifest.skills[n] = `${baseSpecifier.replace(/@.*$/, "")}@${latestCommit}`;
      log.success(n);
      updated++;
    } catch (err) {
      log.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Update external docs
  for (const [n, entry] of docsToUpdate) {
    const resolved = parseSource(entry.source);
    const repoCache = getRepoCache(resolved.repoUrl);
    const baseSpecifier = entry.source.replace(/@[0-9a-f]{7,}$/, "");
    const baseResolved = parseSource(baseSpecifier);

    try {
      if (fs.existsSync(repoCache)) {
        execSync(`git --git-dir="${repoCache}" fetch --all --tags`, { stdio: "pipe" });
      }
    } catch { /* use cached */ }

    let latestCommit: string;
    try {
      latestCommit = execSync(
        `git --git-dir="${repoCache}" rev-parse "${baseResolved.ref}"`,
        { encoding: "utf8", stdio: "pipe" }
      ).trim();
    } catch {
      log.error(`Could not resolve ref for doc "${n}"`);
      continue;
    }

    const currentCommit = resolved.ref.match(/^[0-9a-f]{7,}$/) ? resolved.ref : null;
    if (currentCommit && latestCommit.startsWith(currentCommit)) {
      console.log(`  ${color.dim(`doc:${n} already up to date (${latestCommit.slice(0, 7)})`)}`);
      upToDate++;
      continue;
    }

    const prev = currentCommit?.slice(0, 7) ?? resolved.ref;
    console.log(`  updating doc:${n} ${color.dim(`${prev} → ${latestCommit.slice(0, 7)}`)}...`);

    const tmpDir = path.join(os.homedir(), ".vulyk", "tmp", `doc-${n}`);
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });

    try {
      baseResolved.ref = latestCommit;
      fetchSource(baseResolved, tmpDir);

      const docPaths = manifest.paths.docs;
      const destDir = resolvePath(path.join(path.dirname(manifestPath), docPaths[0] ?? "docs/external"));
      fs.mkdirSync(destDir, { recursive: true });
      const files = fs.readdirSync(tmpDir);
      const mdFile = files.find((f) => f.endsWith(".md"));
      if (!mdFile) throw new Error("No markdown file found");
      fs.copyFileSync(path.join(tmpDir, mdFile), path.join(destDir, `${n}.md`));
      fs.writeFileSync(path.join(destDir, MARKER), "");
      fs.rmSync(tmpDir, { recursive: true, force: true });

      manifest.docs[n] = { ...entry, source: `${baseSpecifier.replace(/@.*$/, "")}@${latestCommit}` };
      log.success(`doc:${n}`);
      updated++;
    } catch (err) {
      log.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (updated > 0) writeManifest(manifestPath, manifest);

  console.log("");
  if (updated > 0) log.success(`Updated ${String(updated)} item(s)`);
  if (upToDate > 0) log.dim(`${String(upToDate)} already up to date`);
}
