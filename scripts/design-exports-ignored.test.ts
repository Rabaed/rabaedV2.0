import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The owner drops Claude Design HTML exports at the top of design/reference/
// (RP-663). They embed licensed fonts (Thmanyah) and the repo is public, so the
// root .gitignore keeps them out, while the kit and the owner's committed
// reference pages in sub-folders stay tracked.
const repo = join(import.meta.dirname, "..");

/** Whether the repository's ignore rules match a path, tracked or not. */
const ignored = (path: string) => spawnSync("git", ["check-ignore", "--no-index", "-q", path], { cwd: repo }).status === 0;

describe("owner design exports in design/reference/", () => {
  it.each([
    "design/reference/Rabaed Submittals List with import feature.html",
    "design/reference/Rabaed Admin Import Register.html",
    "design/reference/Rabaed Packages.html",
    "design/reference/Any New Export.HTML",
  ])("ignores %s", (path) => {
    expect(ignored(path)).toBe(true);
  });

  it.each([
    "design/reference/claude-design/components/core/core.card.html",
    "design/reference/submittal-panel/Submittals List (standalone).html",
    "design/reference/sign-in/sign-in.html",
    "design/reference/README.md",
  ])("keeps %s trackable", (path) => {
    expect(ignored(path)).toBe(false);
  });

  it("hides no file the repository tracks under design/", () => {
    const trackedButIgnored = execFileSync("git", ["-c", "core.quotePath=false", "ls-files", "--cached", "--ignored", "--exclude-standard", "--", "design"], { cwd: repo, encoding: "utf8" });
    expect(trackedButIgnored.split("\n").filter(Boolean)).toEqual([]);
  });
});
