import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// No font is ever committed, on any branch, in any commit. Free fonts come
// from npm (@fontsource); the licensed Thmanyah fonts come from the private
// build assets bucket at deploy time (RP-211). The repo is public, so a font
// removed later would still be published by its history.
//
// Two checks. Font files, by path: they are binary, which gitleaks skips.
// Font data embedded in text files (RP-962): a Claude Design export carries its
// fonts base64 in its manifest; strip them first with `pnpm design:strip-fonts`.
//
// Usage: node scripts/check-no-fonts.ts            the whole history (fetch-depth 0 in CI)
//        node scripts/check-no-fonts.ts --staged   the files staged for the next commit

const fontFile = /\.(woff2?|otf|ttf|eot)$/i;

/** Every font file path in the repository's history (all refs and HEAD). */
export function committedFontFiles(repo: string): string[] {
  const objects = execFileSync("git", ["rev-list", "--objects", "--all", "HEAD"], { cwd: repo, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  // Commits are listed as "<sha>", trees and blobs as "<sha> <path>".
  const paths = objects
    .split("\n")
    .map((line) => /^[0-9a-f]+ (.+)$/.exec(line)?.[1])
    .filter((path): path is string => !!path && fontFile.test(path));
  return [...new Set(paths)];
}

// Font data embedded in a text file: a Claude Design manifest entry whose "mime"
// is a font type (its bytes base64 beside it), or a base64 data URL. A data URL
// counts only with base64 bytes after it, so code that builds one at run time
// (apps/worker/src/record/fonts.ts) passes. gitleaks' inlined-font rule
// (.gitleaks.toml) also finds the data URLs, but not the manifest entries.
// The manifest may sit JSON-escaped inside a script string, its quotes backslashed.
// POSIX EREs, read without regard to case, for git grep -E and git log -G, and
// by JavaScript in isFontMime (design:strip-fonts).
const fontMime = String.raw`(font/|application/(x-)?font|application/vnd\.ms-fontobject)`;
export const embeddedFont = String.raw`\\?"mime\\?" *: *\\?"${fontMime}|data:${fontMime}[^,]*;base64,[A-Za-z0-9+/]{16}`;

/** Whether a mime type is a font's: the one rule for the check and design:strip-fonts. */
export const isFontMime = (mime: string) => new RegExp(`^${fontMime}`, "i").test(mime);

/** Every text file path that held embedded font data in the history (all refs and HEAD). */
export function filesWithEmbeddedFonts(repo: string): string[] {
  // Every commit whose diff adds or removes a match. A merge is diffed against its
  // first parent, so a font only the merge brought in is found too (~5 s on the
  // full history, against ~2 s without merges).
  const paths = gitLines(repo, ["log", "--all", "HEAD", "--diff-merges=first-parent", "-E", "-i", `-G${embeddedFont}`, "--format=", "--name-only"]);
  return [...new Set(paths)];
}

/** Every path staged to be added, changed or renamed into. */
const stagedPaths = (repo: string) => gitLines(repo, ["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);

/** Every font file staged for the next commit, by path. */
export function stagedFontFiles(repo: string): string[] {
  return stagedPaths(repo).filter((path) => fontFile.test(path));
}

/** Every text file staged to be added or changed that holds embedded font data: the check before a commit. */
export function stagedFilesWithEmbeddedFonts(repo: string): string[] {
  const staged = new Set(stagedPaths(repo));
  const inIndex = gitLines(repo, ["grep", "--cached", "-I", "-i", "-l", "-E", "-e", embeddedFont, "--"]);
  return inIndex.filter((path) => staged.has(path));
}

/** A git command's output lines, paths unquoted; git grep's "nothing found" (exit 1) is no lines. */
function gitLines(repo: string, args: string[]): string[] {
  try {
    return execFileSync("git", ["-c", "core.quotePath=false", ...args], { cwd: repo, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
      .split("\n")
      .filter(Boolean);
  } catch (error) {
    if ((error as { status?: number }).status === 1) return [];
    throw error;
  }
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  const repo = process.cwd();
  const staged = process.argv.includes("--staged");
  const where = staged ? "in the staged changes" : "in the repository history";
  const fontFiles = staged ? stagedFontFiles(repo) : committedFontFiles(repo);
  const embedded = staged ? stagedFilesWithEmbeddedFonts(repo) : filesWithEmbeddedFonts(repo);
  if (fontFiles.length > 0) {
    console.error(`Font files are ${where}; they must never be committed (licence, and the repo is public):`);
    for (const path of fontFiles) console.error(`  ${path}`);
  }
  if (embedded.length > 0) {
    console.error(`Font data is embedded ${where}; strip it first (pnpm design:strip-fonts <in> <out> for a Claude Design export):`);
    for (const path of embedded) console.error(`  ${path}`);
  }
  if (fontFiles.length + embedded.length > 0) process.exit(1);
  console.log(`No fonts ${where}.`);
}
