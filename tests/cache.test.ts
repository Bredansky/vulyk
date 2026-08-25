import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import * as process from "node:process";
import { getRepoCachePath } from "../src/lib/cache.js";

const previousCacheDir = process.env.VULYK_CACHE_DIR;

afterEach(() => {
  if (previousCacheDir === undefined) {
    delete process.env.VULYK_CACHE_DIR;
  } else {
    process.env.VULYK_CACHE_DIR = previousCacheDir;
  }
});

void test("getRepoCachePath stores cache under the project-local .vulyk directory", () => {
  delete process.env.VULYK_CACHE_DIR;

  assert.equal(
    getRepoCachePath("https://github.com/example/repo.git").includes(
      `${path.sep}.vulyk${path.sep}cache${path.sep}`,
    ),
    true,
  );
  assert.equal(
    getRepoCachePath("https://github.com/example/repo.git").includes(
      `${path.sep}.vulyk${path.sep}cache${path.sep}`,
    ),
    true,
  );
});
