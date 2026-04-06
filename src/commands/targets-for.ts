import { findTargetsForDoc } from "../lib/docs.js";
import { log } from "../lib/log.js";

export function targetsForCommand(docPath: string): void {
  const result = findTargetsForDoc(docPath);
  log.print(`${JSON.stringify(result, null, 2)}\n`);
}
