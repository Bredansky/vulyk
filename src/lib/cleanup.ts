// `cleanup.ts` used to walk the filesystem searching for per-directory
// `.vulyk` markers. That mechanism is gone — .vulyk at the
// project root is now the single source of truth.
//
// `cleanupStale` is preserved as a thin wrapper over
// `state.applyCleanupDelta` so callers (sync.ts, the agents command,
// remove.ts) keep their existing import surface. Implementation detail
// lives in `state.ts` because cleanup is now "delete paths in prev
// not in curr" — a state operation, not a marker-walk operation.

import { applyCleanupDelta } from "./state.js";

/**
 * Delete every root-relative path in `prev` not in `curr`. Also
 * prunes empty parent directories up to but not including `dir`.
 *
 * @param dir       Project root (absolute path).
 * @param prev      Paths the last sync/agents wrote (root-relative).
 * @param curr      Paths this run wrote (root-relative).
 */
export function cleanupStale(
  dir: string,
  prev: string[],
  curr: string[],
): void {
  applyCleanupDelta(dir, prev, curr);
}
