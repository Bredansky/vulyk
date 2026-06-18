import { findTargetsForDoc } from "../lib/docs.js";
import { log } from "../lib/log.js";

export function findTargetsCommand(docPath: string): void {
  const result = findTargetsForDoc(docPath);
  log.print(`${JSON.stringify(result, null, 2)}\n`);
}
