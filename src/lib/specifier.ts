function isCommitLike(value: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(value);
}

export function stripPinnedRef(specifier: string): string {
  if (!specifier.startsWith("https://github.com/")) {
    return specifier;
  }

  const url = new URL(specifier);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length >= 5 && (parts[2] === "blob" || parts[2] === "tree")) {
    parts[3] = isCommitLike(parts[3] ?? "") ? "HEAD" : (parts[3] ?? "HEAD");
    url.pathname = `/${parts.join("/")}`;
  }
  return url.toString();
}

export function pinSpecifier(specifier: string, commit: string): string {
  const baseSpecifier = stripPinnedRef(specifier);
  if (!baseSpecifier.startsWith("https://github.com/")) {
    return baseSpecifier;
  }

  const url = new URL(baseSpecifier);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length >= 4 && (parts[2] === "blob" || parts[2] === "tree")) {
    parts[3] = commit;
    url.pathname = `/${parts.join("/")}`;
    return url.toString();
  }

  throw new Error(
    `Cannot pin unsupported GitHub specifier "${specifier}". Use a blob/tree URL with a path.`,
  );
}
