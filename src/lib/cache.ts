import * as crypto from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";

export function getRepoCachePath(repoUrl: string): string {
  const repoHash = crypto.createHash("sha256").update(repoUrl).digest("hex");
  const cacheRoot =
    process.env.VULYK_CACHE_DIR ?? path.join(os.homedir(), ".vulyk", "cache");
  return path.join(cacheRoot, repoHash);
}
