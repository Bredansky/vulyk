import { parseSource } from "./fetcher.js";
import { isPinnedGitHubSpecifier, isRemoteSpecifier } from "./specifier.js";

function validateRemoteSourceShape(
  kindLabel: string,
  name: string,
  source: string,
): void {
  if (!isRemoteSpecifier(source)) {
    throw new Error(`${kindLabel} source for "${name}" must be a remote URL.`);
  }

  if (
    source.startsWith("https://github.com/") &&
    !isPinnedGitHubSpecifier(source)
  ) {
    throw new Error(
      `${kindLabel} source for "${name}" must use a commit-pinned GitHub blob/tree URL.`,
    );
  }

  try {
    parseSource(source);
  } catch (error) {
    throw new Error(
      `${kindLabel} source for "${name}" is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function validateRemoteSkillSource(name: string, source: string): void {
  validateRemoteSourceShape("Skill", name, source);
}

export function validateRemoteDocSource(name: string, source: string): void {
  validateRemoteSourceShape("Doc", name, source);
}
