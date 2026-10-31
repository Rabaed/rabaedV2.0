import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claudeDesignExport, fakeBase64, font, nestedPage } from "./claude-design-export.fixtures.ts";
import { committedFontFiles, embeddedFont, filesWithEmbeddedFonts, stagedFilesWithEmbeddedFonts, stagedFontFiles } from "./check-no-fonts.ts";
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

  it("checks only a range's commits when given one: a font on another branch is not this range's", () => {
    git("checkout", "-q", "-b", "other");
    commit({ "other.woff2": "wOF2\u0000" });
    git("checkout", "-q", "-b", "pr", "main");
    commit({ "pr.txt": "clean\n" });
    expect(committedFontFiles(repo, "main..pr")).toEqual([]);
    commit({ "design/fonts/added-then-removed.ttf": "\u0000\u0001" });
    git("rm", "-q", "design/fonts/added-then-removed.ttf");
    git("commit", "-q", "-m", "remove");
    expect(committedFontFiles(repo, "main..pr")).toEqual(["design/fonts/added-then-removed.ttf"]);
  });

  it("finds a font that a pull request's merge of another branch brings into its range", () => {
    git("checkout", "-q", "-b", "other");
    commit({ "other.woff2": "wOF2\u0000" });
    git("checkout", "-q", "-b", "pr", "main");
    commit({ "pr.txt": "clean\n" });
    git("merge", "-q", "--no-edit", "other");
    expect(committedFontFiles(repo, "main..pr")).toEqual(["other.woff2"]);
  });

  it("checks one branch's whole history when given a single revision", () => {
    commit({ "old.otf": "OTTO\u0000" });
    git("rm", "-q", "old.otf");
    git("commit", "-q", "-m", "remove");
    git("checkout", "-q", "-b", "other");
    commit({ "other.woff2": "wOF2\u0000" });
    git("checkout", "-q", "main");
    expect(committedFontFiles(repo, "HEAD")).toEqual(["old.otf"]);
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

  // An owner export renamed and moved out of design/reference/, where .gitignore no longer hides it (RP-663).
  const thmanyahFace = (mime: string) => `<style>@font-face { font-family: "Thmanyah Sans"; src: url('data:${mime};base64,${fakeBase64}') format("woff2"); }</style>`;

  it("finds a Thmanyah @font-face inlined in a committed page moved out of design/reference/", () => {
    commit({ "docs/notes/submittals-page.htm": thmanyahFace(font("woff2")) });
    expect(filesWithEmbeddedFonts(repo)).toEqual(["docs/notes/submittals-page.htm"]);
  });

  it("finds a Thmanyah @font-face staged in a page moved out of design/reference/", () => {
    writeFileSync(join(repo, "board.html"), thmanyahFace(font("woff2")));
    git("add", "board.html");
    expect(stagedFilesWithEmbeddedFonts(repo)).toEqual(["board.html"]);
  });

  it("finds an @font-face whose inlined font hides behind a generic mime type: format() names it a font", () => {
    commit({ "octet.html": thmanyahFace("application/octet-stream"), "untyped.css": thmanyahFace("") });
    expect(filesWithEmbeddedFonts(repo).sort()).toEqual(["octet.html", "untyped.css"]);
  });

  it("ignores an @font-face that loads its font from a URL", () => {
    commit({ "fonts.css": `@font-face { font-family: "Thmanyah Sans"; src: url("/fonts/thmanyahsans-Regular.woff2") format("woff2"); }` });
    expect(filesWithEmbeddedFonts(repo)).toEqual([]);
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

  it("checks only a range's commits when given one: a font on another branch is not this range's", () => {
    git("checkout", "-q", "-b", "other");
    commit({ "other.css": `src: url(data:${font("woff")};base64,${fakeBase64})` });
    git("checkout", "-q", "-b", "pr", "main");
    commit({ "pr.txt": "clean\n" });
    expect(filesWithEmbeddedFonts(repo, "main..pr")).toEqual([]);
    commit({ "design/export.html": claudeDesignExport({ a1: { mime: font("woff2"), data: fakeBase64 } }) });
    commit({ "design/export.html": claudeDesignExport({}) }, "strip");
    expect(filesWithEmbeddedFonts(repo, "main..pr")).toEqual(["design/export.html"]);
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

// An export that nests whole other exports as text/html manifest entries, gzipped, each with its own fonts (RP-1146).
describe("a font in a page nested in a Claude Design export", () => {
  const withFont = () => claudeDesignExport({ app: { mime: "application/javascript", data: fakeBase64 }, thmanyah: { mime: font("woff2"), data: fakeBase64 } });
  const board = (inner = withFont(), compressed = true) => claudeDesignExport({ logo: { mime: "image/svg+xml", data: fakeBase64 }, board: nestedPage(inner, compressed) });

  it("is out of git grep's sight: the outer page alone shows no font", () => {
    expect(new RegExp(embeddedFont, "i").test(board())).toBe(false);
  });

  it("is found in a staged export, gzipped or plain, at any depth", () => {
    writeFileSync(join(repo, "gzipped.html"), board());
    writeFileSync(join(repo, "plain.html"), board(withFont(), false));
    writeFileSync(join(repo, "deep.html"), board(board()));
    writeFileSync(join(repo, "unstaged.html"), board());
    git("add", "gzipped.html", "plain.html", "deep.html");
    expect(stagedFilesWithEmbeddedFonts(repo).sort()).toEqual(["deep.html", "gzipped.html", "plain.html"]);
  });

  it("is found by the same rule as the rest of the check: a nested page's inlined @font-face too", () => {
    writeFileSync(join(repo, "face.html"), board(`<style>@font-face { src: url(data:${font("woff2")};base64,${fakeBase64}); }</style>`));
    git("add", "face.html");
    expect(stagedFilesWithEmbeddedFonts(repo)).toEqual(["face.html"]);
  });

  it("passes once design:strip-fonts has removed it, and a nested page without fonts passes", () => {
    writeFileSync(join(repo, "stripped.html"), stripFonts(board()).html);
    writeFileSync(join(repo, "clean.html"), board(claudeDesignExport({ app: { mime: "application/javascript", data: fakeBase64 } })));
    git("add", "-A");
    expect(stagedFilesWithEmbeddedFonts(repo)).toEqual([]);
    git("commit", "-q", "-m", "clean");
    expect(filesWithEmbeddedFonts(repo)).toEqual([]);
  });

  it("is found in the history once committed, on any branch, though stripped later", () => {
    git("checkout", "-q", "-b", "feature");
    commit({ "design/handoff/Board.HTML": board() });
    commit({ "design/handoff/Board.HTML": stripFonts(board()).html }, "strip");
    git("checkout", "-q", "main");
    expect(filesWithEmbeddedFonts(repo)).toEqual(["design/handoff/Board.HTML"]);
  });

  it("is found only in a range's own commits when given one", () => {
    git("checkout", "-q", "-b", "other");
    commit({ "other.html": board() });
    git("checkout", "-q", "-b", "pr", "main");
    commit({ "pr.htm": board(claudeDesignExport({})) });
    expect(filesWithEmbeddedFonts(repo, "main..pr")).toEqual([]);
    commit({ "pr.htm": board() });
    expect(filesWithEmbeddedFonts(repo, "main..pr")).toEqual(["pr.htm"]);
  });

  it("is found in an export under any name, renamed into it too", () => {
    writeFileSync(join(repo, "board.txt"), board());
    git("add", "board.txt");
    expect(stagedFilesWithEmbeddedFonts(repo)).toEqual(["board.txt"]);
    git("checkout", "-q", "-b", "pr");
    commit({ "notes/board": board() });
    git("mv", "notes/board", "notes/board.svg");
    git("commit", "-q", "-m", "rename");
    git("rm", "-q", "notes/board.svg");
    git("commit", "-q", "-m", "remove");
    expect(filesWithEmbeddedFonts(repo, "main..pr").sort()).toEqual(["board.txt", "notes/board", "notes/board.svg"]);
  });

  it("passes code that quotes the manifest tag: a manifest that is no JSON nests no page", () => {
    writeFileSync(join(repo, "fixture.ts"), 'const page = `<script type="__bundler/manifest">${JSON.stringify(manifest)}</script>`;\n');
    writeFileSync(join(repo, "notes.html"), '<pre><script type="__bundler/manifest">{ ... }</script></pre>\n');
    git("add", "-A");
    expect(stagedFilesWithEmbeddedFonts(repo)).toEqual([]);
    git("commit", "-q", "-m", "notes");
    expect(filesWithEmbeddedFonts(repo)).toEqual([]);
  });

  it("counts a nested page that cannot be decoded as a font: it cannot be shown to hold none", () => {
    writeFileSync(join(repo, "broken.html"), claudeDesignExport({ board: { mime: "text/html", compressed: true, data: fakeBase64 } }));
    git("add", "broken.html");
    expect(stagedFilesWithEmbeddedFonts(repo)).toEqual(["broken.html"]);
    git("commit", "-q", "--no-verify", "-m", "broken");
    expect(filesWithEmbeddedFonts(repo)).toEqual(["broken.html"]);
  });

  it("is refused by the pre-commit check, naming the file", () => {
    writeFileSync(join(repo, "board.html"), board());
    git("add", "board.html");
    const result = spawnSync("node", [join(import.meta.dirname, "check-no-fonts.ts"), "--staged"], { cwd: repo, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("board.html");
  });
});

describe("node scripts/check-no-fonts.ts --range", () => {
  const check = (range: string) => spawnSync("node", [join(import.meta.dirname, "check-no-fonts.ts"), "--range", range], { cwd: repo, encoding: "utf8" });

  it("passes a pull request's own clean commits while another branch holds a font, and fails one that adds a font", () => {
    git("checkout", "-q", "-b", "other");
    commit({ "other.woff2": "wOF2\u0000" });
    git("checkout", "-q", "-b", "pr", "main");
    commit({ "pr.txt": "clean\n" });
    expect(check("main..pr")).toMatchObject({ status: 0, stdout: expect.stringContaining("No fonts in main..pr") });
    commit({ "a.css": `src: url(data:${font("woff")};base64,${fakeBase64})`, "b.ttf": "\u0000\u0001" });
    const failed = check("main..pr");
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("b.ttf");
    expect(failed.stderr).toContain("a.css");
    expect(failed.stderr).not.toContain("other.woff2");
  });
});
