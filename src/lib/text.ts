import * as fs from "node:fs";
import * as path from "node:path";

const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".csv",
  ".html",
  ".ini",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mdx",
  ".mjs",
  ".sh",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

export function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

export function writeTextFile(filePath: string, content: string): void {
  fs.writeFileSync(filePath, normalizeLineEndings(content), "utf8");
}

export function copyFilePreservingBinary(
  sourcePath: string,
  destPath: string,
): void {
  if (!TEXT_EXTENSIONS.has(path.extname(sourcePath).toLowerCase())) {
    fs.copyFileSync(sourcePath, destPath);
    return;
  }

  writeTextFile(destPath, fs.readFileSync(sourcePath, "utf8"));
}
