import { addCommand } from "./add.js";

export function docAddCommand(
  specifier: string,
  _opts: { targets?: string[]; description?: string },
): void {
  // Delegate to the unified add command with type "doc"
  // Note: The unified add command currently defaults to skill if type is not specified.
  // We should ensure the unified add command handles doc-specific options if needed,
  // but for now, we just pass the type.
  void addCommand(specifier, { type: "doc" });
}
