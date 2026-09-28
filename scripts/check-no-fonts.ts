import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// No font file is ever committed, on any branch, in any commit. Free fonts
// come from npm (@fontsource); the licensed Thmanyah fonts come from the
// private build assets bucket at deploy time (RP-211). The repo is public, so
// a font removed later would still be published by its history.
//
// Checked by path, because font files are binary: gitleaks skips binary
// files, and only catches fonts inlined into text as base64 (.gitleaks.toml).
//
// Usage: node scripts/check-no-fonts.ts   (needs the full history: fetch-depth 0 in CI)

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

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  const found = committedFontFiles(process.cwd());
  if (found.length > 0) {
    console.error("Font files are in the repository history; they must never be committed (licence, and the repo is public):");
    for (const path of found) console.error(`  ${path}`);
    process.exit(1);
  }
  console.log("No font files in the repository history.");
}
