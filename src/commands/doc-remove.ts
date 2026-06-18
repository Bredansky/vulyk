import { removeCommand } from "./remove.js";

export function docRemoveCommand(name: string): void {
  // Delegate to the unified remove command
  removeCommand(name);
}
