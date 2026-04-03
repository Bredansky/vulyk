import * as crypto from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";

export function getRepoCachePath(repoUrl: string): string {
  const repoHash = crypto.createHash("sha256").update(repoUrl).digest("hex");
  return path.join(os.homedir(), ".vulyk", "cache", repoHash);
}
