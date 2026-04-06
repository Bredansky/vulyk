import { findDocsForFile } from "../lib/docs.js";
import { log } from "../lib/log.js";

export function docsForCommand(filePath: string): void {
  const result = findDocsForFile(filePath);
  log.print(`${JSON.stringify(result, null, 2)}\n`);
}
