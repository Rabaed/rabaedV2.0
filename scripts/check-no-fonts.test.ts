import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { committedFontFiles } from "./check-no-fonts.ts";

// A throwaway repository; the "fonts" are binary stand-ins, like real woff2 files.
let repo: string;
const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd: repo });

function commit(files: Record<string, string>, message = "change") {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  git("add", "-A");
  git("commit", "-q", "-m", message);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "rabaed-fonts-repo-"));
  git("init", "-q", "-b", "main");
  commit({ "README.md": "# repo\n" }, "start");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("committedFontFiles", () => {
  it("finds nothing in a repository without font files", () => {
    commit({ "packages/ui/src/fonts/arabic-font.ts": "export {};\n" });
    expect(committedFontFiles(repo)).toEqual([]);
  });

  it("finds a font file committed and later deleted: it stays in history", () => {
    commit({ "design/fonts/thmanyahsans-Regular.woff2": "wOF2\u0000\u0001binary" });
    git("rm", "-q", "design/fonts/thmanyahsans-Regular.woff2");
    git("commit", "-q", "-m", "remove");
    expect(committedFontFiles(repo)).toEqual(["design/fonts/thmanyahsans-Regular.woff2"]);
  });

  it("finds font files on any branch, whatever they are named or cased", () => {
    git("checkout", "-q", "-b", "feature");
    commit({ "public/arabic.WOFF2": "wOF2\u0000", "a/b.otf": "OTTO\u0000", "c.ttf": "\u0000\u0001", "d.woff": "wOFF", "e.eot": "x" });
    git("checkout", "-q", "main");
    expect(committedFontFiles(repo).sort()).toEqual(["a/b.otf", "c.ttf", "d.woff", "e.eot", "public/arabic.WOFF2"]);
  });

  it("ignores names that only look like fonts", () => {
    commit({ "docs/woff2.md": "notes\n", "fonts.ts": "export {};\n", "x.otf.md": "notes\n" });
    expect(committedFontFiles(repo)).toEqual([]);
  });
});
