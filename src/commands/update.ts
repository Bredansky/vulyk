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
  return path.join(
    os.homedir(),
    ".vulyk",
    "cache",
    Buffer.from(repoUrl).toString("base64url").slice(0, 32),
  );
}

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

export function updateCommand(name?: string): void {
  const manifestPath = findManifest();
  if (!manifestPath) {
    log.error("No vulyk.json found.");
    process.exit(1);
  }

  const manifest = readManifest(manifestPath);

  const skills = name
    ? Object.entries(manifest.skills).filter(([n]) => n === name)
    : Object.entries(manifest.skills);
  const docs = name
    ? Object.entries(manifest.docs).filter(([n]) => n === name)
    : Object.entries(manifest.docs);

  if (skills.length === 0 && docs.length === 0) {
    log.warn(name ? `"${name}" not found` : "Nothing to update");
    return;
  }

  let updated = 0;

  if (skills.length > 0) log.print(color.dim("\nSkills:"));

  for (const [n, specifier] of skills) {
    const resolved = parseSource(specifier);
    const repoCache = getRepoCache(resolved.repoUrl);
    const baseSpecifier = specifier.replace(/@[0-9a-f]{7,}$/, "");
    const baseResolved = parseSource(baseSpecifier);

    let latestCommit: string;
    try {
      latestCommit = fetchLatest(repoCache, baseResolved.ref);
    } catch {
      log.error(`Could not resolve ref for "${n}"`);
      continue;
    }

    const currentCommit = /^[0-9a-f]{7,}$/.exec(resolved.ref)
      ? resolved.ref
      : null;
    if (currentCommit && latestCommit === currentCommit) {
      log.print(
        `  ${color.dim(`${n} already up to date (${latestCommit.slice(0, 7)})`)}`,
      );
      continue;
    }

    const prev = currentCommit?.slice(0, 7) ?? resolved.ref;
    log.print(
      `  ${color.blue(n)} ${color.dim(`${prev} → ${latestCommit.slice(0, 7)}`)}`,
    );

    const tmpDir = path.join(os.homedir(), ".vulyk", "tmp", n);
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    try {
      baseResolved.ref = latestCommit;
      fetchSource(baseResolved, tmpDir);
      install(n, tmpDir, manifest.paths.skills);
      fs.rmSync(tmpDir, { recursive: true, force: true });
      manifest.skills[n] =
        `${baseSpecifier.replace(/@.*$/, "")}@${latestCommit}`;
      log.success(n);
      updated++;
    } catch (err) {
      log.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (docs.length > 0) log.print(color.dim("\nDocs:"));

  for (const [n, entry] of docs) {
    const resolved = parseSource(entry.source);
    const repoCache = getRepoCache(resolved.repoUrl);
    const baseSpecifier = entry.source.replace(/@[0-9a-f]{7,}$/, "");
    const baseResolved = parseSource(baseSpecifier);

    let latestCommit: string;
    try {
      latestCommit = fetchLatest(repoCache, baseResolved.ref);
    } catch {
      log.error(`Could not resolve ref for "${n}"`);
      continue;
    }

    const currentCommit = /^[0-9a-f]{7,}$/.exec(resolved.ref)
      ? resolved.ref
      : null;
    if (currentCommit && latestCommit === currentCommit) {
      log.print(
        `  ${color.dim(`${n} already up to date (${latestCommit.slice(0, 7)})`)}`,
      );
      continue;
    }

    const prev = currentCommit?.slice(0, 7) ?? resolved.ref;
    log.print(
      `  ${color.blue(n)} ${color.dim(`${prev} → ${latestCommit.slice(0, 7)}`)}`,
    );

    const tmpDir = path.join(os.homedir(), ".vulyk", "tmp", `doc-${n}`);
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    try {
      baseResolved.ref = latestCommit;
      fetchSource(baseResolved, tmpDir);

      const destDir = resolvePath(
        path.join(
          path.dirname(manifestPath),
          manifest.paths.docs[0] ?? "docs/external",
        ),
      );
      fs.mkdirSync(destDir, { recursive: true });
      const mdFile = fs.readdirSync(tmpDir).find((f) => f.endsWith(".md"));
      if (!mdFile) throw new Error("No markdown file found");
      fs.copyFileSync(path.join(tmpDir, mdFile), path.join(destDir, `${n}.md`));
      fs.writeFileSync(path.join(destDir, MARKER), "");
      fs.rmSync(tmpDir, { recursive: true, force: true });

      manifest.docs[n] = {
        ...entry,
        source: `${baseSpecifier.replace(/@.*$/, "")}@${latestCommit}`,
      };
      log.success(n);
      updated++;
    } catch (err) {
      log.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (updated > 0) writeManifest(manifestPath, manifest);
  log.print("");
  if (updated > 0) log.success(`Updated ${String(updated)} item(s)`);
}
