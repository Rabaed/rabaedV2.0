import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { findNonPlainImports, formatChain } from "./import-graph.ts";

// The clean-up tools must run with plain `node` and no installed packages (RP-1198, item 6).
// A Main's recovery worktree had no node_modules, so it cleaned up by hand with `rd` and
// skipped the tools' safety checks. No CI job runs them without an install (the owner's
// decision): this walks their import graph instead, and fails on any import that is not a
// Node builtin or a relative .ts script.
//
// The first three are the tools named in the ticket. The next three reach a package the same
// way, through stories-volumes.ts, and a Main whose worktree cannot install needs them too.
// lanes-drop-dbs.ts drops databases (review P5).
const ENTRY_POINTS = [
  "scripts/lanes-prune.ts",
  "scripts/lane-done.ts",
  "scripts/worktree-remove.ts",
  "scripts/worktrees-prune.ts",
  "scripts/worktrees-clean.ts",
  "scripts/lanes-status.ts",
  "scripts/lanes-drop-dbs.ts",
];

const root = resolve(import.meta.dirname, "..");
const readRepoFile = (path: string): string | undefined => (existsSync(resolve(root, path)) ? readFileSync(resolve(root, path), "utf8") : undefined);

describe("the clean-up tools run with plain node", () => {
  it.each(ENTRY_POINTS)("%s imports only Node builtins and relative .ts scripts, all the way down", (entry) => {
    expect(findNonPlainImports([entry], readRepoFile).map(formatChain)).toEqual([]);
  });

  it("reaches the whole graph: an npm import added deep in a chain is reported with its chain", () => {
    const withPackage = (path: string) => (path === "scripts/prune-guards.ts" ? `${readRepoFile(path)}\nimport "yaml";\n` : readRepoFile(path));
    expect(findNonPlainImports(["scripts/lanes-prune.ts"], withPackage).map(formatChain)).toEqual(["lanes-prune.ts → prune-guards.ts → yaml"]);
  });
});
