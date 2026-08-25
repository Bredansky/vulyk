import * as fs from "node:fs";
import * as path from "node:path";

export function writeConfig(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `export default ${JSON.stringify(value, null, 2)};\n`,
    "utf8",
  );
}

export function statePath(projectRoot: string): string {
  return path.join(projectRoot, ".vulyk", "state.json");
}
