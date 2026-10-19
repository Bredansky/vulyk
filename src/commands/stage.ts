import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { findManifest } from "../lib/manifest.js";
import { log } from "../lib/log.js";
import { readState, writeState } from "../lib/state.js";

/** Git pathspecs are literal, even if generated paths contain glob characters. */
function ownedPathspec(projectRoot: string, relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  const absolute = path.resolve(projectRoot, normalized);

  if (
    !normalized ||
    normalized === "." ||
    normalized
      .split("/")
      .some((segment) => segment === "." || segment === "..") ||
    normalized
      .split("/")
      .some((segment) => segment === ".git" || segment === ".vulyk") ||
    path.isAbsolute(normalized) ||
    path.win32.isAbsolute(normalized) ||
    absolute === projectRoot ||
    !absolute.startsWith(projectRoot + path.sep) ||
    normalized.includes("\0")
  ) {
    throw new Error(
      `Unsafe Vulyk managed path: ${JSON.stringify(relativePath)}`,
    );
  }

  return `:(literal)${normalized}`;
}

/**
 * Stage precisely the Git-trackable files Vulyk owns, not the whole worktree.
 * Ignored, untracked outputs stay ignored; tracked removals are included.
 */
export function stageCommand(): void {
  const manifestPath = findManifest();
  if (!manifestPath) {
    throw new Error("No vulyk.config.ts found. Run `vulyk init` first.");
  }

  const projectRoot = path.dirname(manifestPath);
  execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: projectRoot,
  });
  const state = readState(projectRoot);
  const paths = [
    ...new Set([
      ...state.syncPaths,
      ...state.agentPaths,
      ...(state.pendingStagePaths ?? []),
    ]),
  ].map((p) => ownedPathspec(projectRoot, p));

  // Do not accidentally stage unrelated changes when no generated files exist.
  if (paths.length > 0) {
    const trackedAndVisible = execFileSync(
      "git",
      [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        ...paths,
      ],
      { cwd: projectRoot, encoding: "buffer", maxBuffer: 32 * 1024 * 1024 },
    );

    const files = [
      ...new Set(
        trackedAndVisible.toString("utf8").split("\0").filter(Boolean),
      ),
    ].map((p) => ownedPathspec(projectRoot, p));

    if (files.length > 0) {
      execFileSync(
        "git",
        ["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"],
        {
          cwd: projectRoot,
          input: Buffer.from(`${files.join("\0")}\0`, "utf8"),
        },
      );
    }
  }

  // Retire deleted-output ownership only after Git staging succeeded.
  if ((state.pendingStagePaths?.length ?? 0) > 0) {
    writeState(projectRoot, {
      syncPaths: state.syncPaths,
      agentPaths: state.agentPaths,
    });
  }

  log.success("Vulyk-owned files staged");
}
