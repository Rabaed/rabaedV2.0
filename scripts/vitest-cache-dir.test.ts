import { isAbsolute, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import config from "../vitest.config.ts";

// RP-1182: vitest's cache under node_modules is watched by Turbopack and stalls `next dev`
// in the same worktree, so the cache must sit outside the repository.
describe("vitest cacheDir", () => {
  it("is outside the repository, so Turbopack does not watch it", () => {
    const repo = fileURLToPath(new URL("..", import.meta.url));
    const cacheDir = config.cacheDir;

    expect(cacheDir).toBeTypeOf("string");
    const relativeCacheDir = relative(repo, cacheDir ?? "");
    const outside = isAbsolute(relativeCacheDir) || relativeCacheDir === ".." || relativeCacheDir.startsWith(`..${sep}`);
    expect(outside).toBe(true);
  });
});
