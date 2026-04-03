export function stripPinnedRef(specifier: string): string {
  if (!specifier.startsWith("https://github.com/")) {
    return specifier.replace(/@[0-9a-f]{7,}$/i, "");
  }

  const atIdx = specifier.lastIndexOf("@");
  return atIdx > specifier.indexOf(".com/")
    ? specifier.slice(0, atIdx)
    : specifier;
}

export function pinSpecifier(specifier: string, commit: string): string {
  const baseSpecifier = stripPinnedRef(specifier);
  if (!baseSpecifier.startsWith("https://github.com/")) {
    return `${baseSpecifier}@${commit}`;
  }

  const url = new URL(baseSpecifier);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length >= 4 && (parts[2] === "blob" || parts[2] === "tree")) {
    parts[3] = commit;
    url.pathname = `/${parts.join("/")}`;
    return url.toString();
  }

  return `${baseSpecifier}@${commit}`;
}
