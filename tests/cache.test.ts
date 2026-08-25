import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { getRepoCachePath } from "../src/lib/cache.js";

const previousCacheDir = process.env.VULYK_CACHE_DIR;

afterEach(() => {
  if (previousCacheDir === undefined) {
    delete process.env.VULYK_CACHE_DIR;
  } else {
    process.env.VULYK_CACHE_DIR = previousCacheDir;
  }
});

void test("getRepoCachePath never nests cache under the project's .vulyk state file", () => {
  process.env.VULYK_CACHE_DIR = "/tmp/vulyk-test-cache";

  assert.equal(
    getRepoCachePath("https://github.com/example/repo.git").startsWith(
      "/tmp/vulyk-test-cache/",
    ),
    true,
  );
  assert.equal(
    getRepoCachePath("https://github.com/example/repo.git").includes(
      `${path.sep}.vulyk${path.sep}`,
    ),
    false,
  );
});
