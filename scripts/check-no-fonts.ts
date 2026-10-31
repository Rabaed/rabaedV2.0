import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

// No font is ever committed, on any branch, in any commit. Free fonts come
// from npm (@fontsource); the licensed Thmanyah fonts come from the private
// build assets bucket at deploy time (RP-211). The repo is public, so a font
// removed later would still be published by its history.
//
// Two checks. Font files, by path: they are binary, which gitleaks skips.
// Font data embedded in text files (RP-962): a Claude Design export carries its
// fonts base64 in its manifest; strip them first with `pnpm design:strip-fonts`.
// That includes the fonts of the pages an export nests in its manifest, which the
// check decodes (RP-1146).
//
// Usage: node scripts/check-no-fonts.ts                  every branch's history (fetch-depth 0)
//        node scripts/check-no-fonts.ts --range <revs>   only those commits: base..head for a pull
//                                                        request or a queue entry, HEAD for main (RP-678)
//        node scripts/check-no-fonts.ts --staged         the files staged for the next commit
//
// A range keeps one branch's font from failing every other pull request's check;
// the nightly run without one still reads every branch (secret-scan.yml).

const fontFile = /\.(woff2?|otf|ttf|eot)$/i;

/** The revisions a history check reads: the range given, else every ref and HEAD. */
const revisions = (range?: string) => (range ? [range] : ["--all", "HEAD"]);

/** Every font file path in the repository's history (all refs and HEAD), or in a range's commits. */
export function committedFontFiles(repo: string, range?: string): string[] {
  const objects = execFileSync("git", ["rev-list", "--objects", ...revisions(range), "--"], { cwd: repo, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
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
// An @font-face src whose data URL has any other mime type, or none, counts too:
// its format() names it a font (a Thmanyah face renamed out of sight, RP-663).
// POSIX EREs, read without regard to case, for git grep -E and git log -G, and
// by JavaScript in isFontMime (design:strip-fonts).
const fontMime = String.raw`(font/|application/(x-)?font|application/vnd\.ms-fontobject)`;
const fontFaceDataUrl = String.raw`data:[^,]*;base64,[A-Za-z0-9+/=]{16,}['"]?\) *format\(`;
export const embeddedFont = String.raw`\\?"mime\\?" *: *\\?"${fontMime}|data:${fontMime}[^,]*;base64,[A-Za-z0-9+/]{16}|${fontFaceDataUrl}`;

/** Whether a mime type is a font's: the one rule for the check and design:strip-fonts. */
export const isFontMime = (mime: string) => new RegExp(`^${fontMime}`, "i").test(mime);

// A Claude Design export can hold whole other exports as text/html entries of its
// manifest, base64 and usually gzipped, each with its own fonts (RP-1146). Neither
// git grep nor git log -G can read those, so the check decodes them. The helpers
// live here, not in design-strip-fonts.ts, because the pre-commit hook's test runs
// a copy of this file alone (git-hooks.test.ts).

/** One asset in a Claude Design manifest, keyed by uuid. */
export type ManifestEntry = { mime: string; compressed?: boolean; data: string };

// The opening tag may carry more attributes than its type.
export const manifestScript = /(<script\b[^>]*\btype="__bundler\/manifest"[^>]*>)([\s\S]*?)(<\/script>)/;

/** A page's Claude Design manifest, or undefined when it has none. */
export function manifestOf(page: string): Record<string, ManifestEntry> | undefined {
  const match = manifestScript.exec(page);
  return match ? (JSON.parse(match[2]!) as Record<string, ManifestEntry>) : undefined;
}

/** Whether a manifest entry is a whole page nested in the export. */
export const isNestedPage = (entry: ManifestEntry) => /^text\/html\b/i.test(entry.mime ?? "");

/** A nested page's text: base64, gunzipped when compressed. */
export function decodePage(uuid: string, entry: ManifestEntry): string {
  try {
    const bytes = Buffer.from(entry.data, "base64");
    return (entry.compressed ? gunzipSync(bytes) : bytes).toString("utf8");
  } catch (error) {
    throw new Error(`The nested page ${uuid} in the manifest could not be decoded: ${(error as Error).message}`, { cause: error });
  }
}

/** A page's text encoded the way a manifest entry was: base64, gzipped when it was compressed. */
export function encodePage(html: string, like: ManifestEntry): string {
  const bytes = Buffer.from(html, "utf8");
  return (like.compressed ? gzipSync(bytes) : bytes).toString("base64");
}

/** Every page nested in a Claude Design export, decoded, at any depth; none when its manifest is no JSON (a page quoting the tag). */
export function nestedPages(page: string): string[] {
  let manifest: Record<string, ManifestEntry> | undefined;
  try {
    manifest = manifestOf(page);
  } catch {
    return [];
  }
  if (!manifest) return [];
  return Object.entries(manifest)
    .filter(([, entry]) => isNestedPage(entry))
    .flatMap(([uuid, entry]) => {
      const nested = decodePage(uuid, entry);
      return [nested, ...nestedPages(nested)];
    });
}

/** Whether a page nested in this export holds embedded font data, by the same rule as the rest of the check. */
export function hasNestedFont(page: string): boolean {
  const font = new RegExp(embeddedFont, "i");
  return nestedPages(page).some((nested) => font.test(nested));
}

/** Every text file path that held embedded font data in the history (all refs and HEAD), or in a range's commits. */
export function filesWithEmbeddedFonts(repo: string, range?: string): string[] {
  // Every commit whose diff adds or removes a match. A merge is diffed against its
  // first parent, so a font only the merge brought in is found too (~5 s on the
  // full history, against ~2 s without merges).
  const paths = gitLines(repo, ["log", ...revisions(range), "--diff-merges=first-parent", "-E", "-i", `-G${embeddedFont}`, "--format=", "--name-only", "--"]);
  return [...new Set([...paths, ...pagesWithNestedFonts(repo, range)])];
}

// Nested pages are decoded only in .html and .htm files, staged or committed: a Claude
// Design export is a page, code that quotes the manifest tag is not (the test
// fixtures), and decoding every blob in the history would read ~900 MB
// (screenshots, lockfiles) where the pages are ~30 MB.
const pageFile = /\.html?$/i;

/** Every page path whose version in the history (all refs and HEAD), or in a range's commits, nests a page holding a font. */
function pagesWithNestedFonts(repo: string, range?: string): string[] {
  // "--raw" lines: ":<old mode> <new mode> <old blob> <new blob> <status>\t<path>".
  const versions = gitLines(repo, ["log", ...revisions(range), "--diff-merges=first-parent", "--no-renames", "--raw", "--no-abbrev", "--format=", "--"])
    .map((line) => /^:\S+ \S+ \S+ ([0-9a-f]+) [^D]\S*\t(.+)$/.exec(line))
    .filter((match): match is RegExpExecArray => !!match && pageFile.test(match[2]!))
    .map((match) => ({ blob: match[1]!, path: match[2]! }));
  const pages = readBlobs(repo, [...new Set(versions.map((version) => version.blob))]);
  const withFont = new Set([...pages].filter(([, page]) => hasNestedFont(page)).map(([blob]) => blob));
  return [...new Set(versions.filter((version) => withFont.has(version.blob)).map((version) => version.path))];
}

/** Blobs' text by object name (or "<rev>:<path>"), read in one git cat-file. */
function readBlobs(repo: string, names: string[]): Map<string, string> {
  const blobs = new Map<string, string>();
  if (names.length === 0) return blobs;
  // eslint-disable-next-line rabaed/no-avoid-terms -- git cat-file's own flag, not a Transmittal
  const out = execFileSync("git", ["cat-file", "--batch"], { cwd: repo, input: names.join("\n") + "\n", maxBuffer: 1024 * 1024 * 1024 });
  // Each object: "<sha> <type> <size>\n<bytes>\n"; a missing one: "<name> missing\n".
  let at = 0;
  for (const name of names) {
    const headerEnd = out.indexOf(0x0a, at);
    const header = out.subarray(at, headerEnd).toString("utf8").split(" ");
    at = headerEnd + 1;
    if (header.length !== 3) continue;
    const size = Number(header[2]);
    blobs.set(name, out.subarray(at, at + size).toString("utf8"));
    at += size + 1;
  }
  return blobs;
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
  const inIndex = gitLines(repo, ["grep", "--cached", "-I", "-i", "-l", "-E", "-e", embeddedFont, "--"]).filter((path) => staged.has(path));
  const exports = gitLines(repo, ["grep", "--cached", "-I", "-l", "-F", "-e", "__bundler/manifest", "--"]).filter(
    (path) => staged.has(path) && pageFile.test(path) && !inIndex.includes(path),
  );
  const pages = readBlobs(repo, exports.map((path) => `:${path}`));
  return [...inIndex, ...exports.filter((path) => hasNestedFont(pages.get(`:${path}`) ?? ""))];
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
  const rangeAt = process.argv.indexOf("--range");
  const range = rangeAt < 0 ? undefined : process.argv[rangeAt + 1];
  if (rangeAt >= 0 && (!range || range.startsWith("-"))) {
    console.error("--range needs the revisions to check, such as <base sha>..<head sha> or HEAD.");
    process.exit(2);
  }
  const where = staged ? "in the staged changes" : range ? `in ${range}` : "in the repository history";
  const fontFiles = staged ? stagedFontFiles(repo) : committedFontFiles(repo, range);
  const embedded = staged ? stagedFilesWithEmbeddedFonts(repo) : filesWithEmbeddedFonts(repo, range);
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
