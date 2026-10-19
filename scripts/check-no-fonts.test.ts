import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claudeDesignExport, fakeBase64, font } from "./claude-design-export.fixtures.ts";
import { committedFontFiles, filesWithEmbeddedFonts, stagedFilesWithEmbeddedFonts, stagedFontFiles } from "./check-no-fonts.ts";
import { stripFonts } from "./design-strip-fonts.ts";

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

describe("stagedFontFiles", () => {
  it("finds a font file staged for the next commit, even one renamed into a font name", () => {
    commit({ "docs/notes.txt": "wOF2\u0000binary" });
    git("mv", "docs/notes.txt", "docs/Arabic.WOFF2");
    writeFileSync(join(repo, "new.ttf"), "\u0000\u0001");
    writeFileSync(join(repo, "unstaged.otf"), "OTTO\u0000");
    git("add", "new.ttf");
    expect(stagedFontFiles(repo).sort()).toEqual(["docs/Arabic.WOFF2", "new.ttf"]);
  });

  it("ignores a font file staged for deletion", () => {
    commit({ "old.woff": "wOFF" });
    git("rm", "-q", "old.woff");
    expect(stagedFontFiles(repo)).toEqual([]);
  });
});

describe("filesWithEmbeddedFonts", () => {
  it("finds a Claude Design bundle whose manifest carries a font", () => {
    commit({ "design/export.html": claudeDesignExport({ a1: { mime: font("woff2"), data: fakeBase64 } }) });
    expect(filesWithEmbeddedFonts(repo)).toEqual(["design/export.html"]);
  });

  it("passes the same bundle once design:strip-fonts has removed its fonts", () => {
    const page = claudeDesignExport({ logo: { mime: "image/svg+xml", data: fakeBase64 }, a1: { mime: font("woff2"), data: fakeBase64 } });
    commit({ "design/export.html": stripFonts(page).html });
    expect(filesWithEmbeddedFonts(repo)).toEqual([]);
  });

  it("finds a font inlined as a base64 data URL, under any font mime type", () => {
    commit({
      "a.css": `@font-face { src: url(data:${font("woff2")};base64,${fakeBase64}); }`,
      "b.js": `const f = "data:application/font-woff;base64,${fakeBase64}";`,
      "c.html": `<style>@font-face { src: url('data:application/x-font-ttf;charset=utf-8;base64,${fakeBase64}') }</style>`,
    });
    expect(filesWithEmbeddedFonts(repo).sort()).toEqual(["a.css", "b.js", "c.html"]);
  });

  it("finds a manifest font however its mime type is cased, JSON-escaped inside a script string, or the old IE type", () => {
    const fontEntry = (mime: string) => JSON.stringify({ a1: { mime, data: fakeBase64 } });
    commit({
      "upper.html": fontEntry("Font/WOFF2"),
      "escaped.js": `const manifest = ${JSON.stringify(fontEntry(font("woff2")))};`,
      "eot.html": fontEntry("application/vnd.ms-fontobject"),
      "data-url.css": `src: url(DATA:APPLICATION/VND.MS-FONTOBJECT;BASE64,${fakeBase64})`,
    });
    expect(filesWithEmbeddedFonts(repo).sort()).toEqual(["data-url.css", "eot.html", "escaped.js", "upper.html"]);
  });

  it("finds embedded font data committed and later removed, on any branch: it stays in history", () => {
    git("checkout", "-q", "-b", "feature");
    commit({ "design/export.html": claudeDesignExport({ a1: { mime: font("woff2"), data: fakeBase64 } }) });
    commit({ "design/export.html": claudeDesignExport({}) }, "strip");
    git("checkout", "-q", "main");
    expect(filesWithEmbeddedFonts(repo)).toEqual(["design/export.html"]);
  });

  it("finds embedded font data that only a merge commit brought in, on a branch other than HEAD", () => {
    git("checkout", "-q", "-b", "feature");
    commit({ "feature.txt": "feature\n" });
    git("checkout", "-q", "-b", "integration", "main");
    commit({ "integration.txt": "integration\n" });
    git("merge", "-q", "--no-commit", "feature");
    writeFileSync(join(repo, "merged.css"), `src: url(data:${font("WOFF2").toUpperCase()};base64,${fakeBase64})`);
    git("add", "merged.css");
    git("commit", "-q", "-m", "merge");
    git("checkout", "-q", "main");
    expect(filesWithEmbeddedFonts(repo)).toEqual(["merged.css"]);
  });

  it("checks only the staged files before a commit", () => {
    commit({ "old.html": claudeDesignExport({ a1: { mime: font("woff2"), data: fakeBase64 } }) });
    writeFileSync(join(repo, "new.css"), `src: url(data:${font("woff")};base64,${fakeBase64})`);
    writeFileSync(join(repo, "unstaged.css"), `src: url(data:${font("woff")};base64,${fakeBase64})`);
    git("add", "new.css");
    expect(stagedFilesWithEmbeddedFonts(repo)).toEqual(["new.css"]);
  });

  it("ignores code that builds a font data URL at run time, and font names in prose", () => {
    commit({
      "fonts.ts": "const src = `url(data:" + font("woff2") + ";base64,${data})`;\n",
      "notes.md": "Fonts are served as " + font("woff2") + " or application/font-woff from the bucket.\n",
      "manifest.html": claudeDesignExport({ a1: { mime: "image/svg+xml", data: fakeBase64 } }),
    });
    expect(filesWithEmbeddedFonts(repo)).toEqual([]);
  });
});
