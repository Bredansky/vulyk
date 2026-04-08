function isCommitLike(value: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(value);
}

function getGitHubPathParts(specifier: string): string[] | null {
  if (!specifier.startsWith("https://github.com/")) {
    return null;
  }

  const url = new URL(specifier);
  return url.pathname.split("/").filter(Boolean);
}

export function isRemoteSpecifier(specifier: string): boolean {
  return specifier.startsWith("http://") || specifier.startsWith("https://");
}

export function isPinnedGitHubSpecifier(specifier: string): boolean {
  const parts = getGitHubPathParts(specifier);
  if (!parts) return false;

  return (
    parts.length >= 5 &&
    (parts[2] === "blob" || parts[2] === "tree") &&
    isCommitLike(parts[3] ?? "")
  );
}

export function stripPinnedRef(specifier: string): string {
  const parts = getGitHubPathParts(specifier);
  if (!parts) {
    return specifier;
  }

  const url = new URL(specifier);
  if (parts.length >= 5 && (parts[2] === "blob" || parts[2] === "tree")) {
    parts[3] = isCommitLike(parts[3] ?? "") ? "HEAD" : (parts[3] ?? "HEAD");
    url.pathname = `/${parts.join("/")}`;
  }
  return url.toString();
}

export function pinSpecifier(specifier: string, commit: string): string {
  const baseSpecifier = stripPinnedRef(specifier);
  const parts = getGitHubPathParts(baseSpecifier);
  if (!parts) {
    return baseSpecifier;
  }

  const url = new URL(baseSpecifier);
  if (parts.length >= 4 && (parts[2] === "blob" || parts[2] === "tree")) {
    parts[3] = commit;
    url.pathname = `/${parts.join("/")}`;
    return url.toString();
  }

  throw new Error(
    `Cannot pin unsupported GitHub specifier "${specifier}". Use a blob/tree URL with a path.`,
  );
}
