import { isBuiltin } from "node:module";
import { basename, dirname, join, normalize } from "node:path/posix";

// The import graph of a script, read without loading it (RP-1198, item 6).
//
// Why: the clean-up tools (lanes:prune, lane:done, worktree:remove and the other
// worktree scripts) must run with plain `node` and no installed packages. A Main's
// recovery worktree had no node_modules, so it cleaned up by hand with `rd` and
// skipped the tools' safety checks. scripts/plain-node.test.ts walks the graph with
// this and fails on any import that is not a Node builtin or a relative .ts script.
//
// Reading, not loading: nothing here runs the scripts, so the check needs no
// node_modules either. Dependency-free itself, for the same reason.

/** What `import()` with a computed specifier reports: it cannot be followed, so it counts as not plain. */
export const COMPUTED_IMPORT = "<computed import()>";

/**
 * Copy of `source` with comments blanked and the text of string and template literals
 * replaced by `_`, same length, so a keyword search cannot match inside either. The quotes stay.
 */
function mask(source: string): string {
  let out = "";
  let i = 0;
  let lastSignificant = "";
  while (i < source.length) {
    const c = source[i]!;
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") {
        out += " ";
        i++;
      }
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (; i < stop; i++) out += source[i] === "\n" ? "\n" : " ";
    } else if (c === '"' || c === "'" || c === "`") {
      out += c;
      i++;
      while (i < source.length && source[i] !== c) {
        const escaped = source[i] === "\\" && i + 1 < source.length;
        out += source[i] === "\n" ? "\n" : "_";
        i++;
        if (escaped) {
          out += source[i] === "\n" ? "\n" : "_";
          i++;
        }
      }
      if (i < source.length) {
        out += c;
        i++;
      }
      lastSignificant = c;
    } else if (c === "/" && (lastSignificant === "" || "(,=:[!&|?{};".includes(lastSignificant))) {
      // A regular expression literal: skip to its closing slash, so a quote inside it opens no string.
      out += c;
      i++;
      let inClass = false;
      while (i < source.length && source[i] !== "\n" && (inClass || source[i] !== "/")) {
        if (source[i] === "\\") {
          out += "_";
          i++;
        } else if (source[i] === "[") inClass = true;
        else if (source[i] === "]") inClass = false;
        out += "_";
        i++;
      }
      if (i < source.length && source[i] === "/") {
        out += "/";
        i++;
      }
      lastSignificant = "/";
    } else {
      out += c;
      if (!/\s/.test(c)) lastSignificant = c;
      i++;
    }
  }
  return out;
}

const FROM = /\b(?:import|export)(\s+type\b)?[^;'"`]*?\bfrom\s*(["'`])(_*)\2/dg;
const SIDE_EFFECT = /\bimport\s*(["'`])(_*)\1/dg;
const DYNAMIC = /\bimport\s*\(\s*(["'`])(_*)\1\s*[,)]/dg;
const COMPUTED = /\bimport\s*\((?!\s*["'`])/g;

/**
 * The module specifiers `source` loads at runtime, in order: `import … from`, `import "x"`,
 * `export … from` and `import("x")`. `import type` and `export type … from` are erased by Node's
 * type stripping and are skipped; `import { type A } from "x"` is not (it still loads "x").
 */
export function runtimeImports(source: string): string[] {
  const masked = mask(source);
  const found: { at: number; specifier: string }[] = [];
  const slice = (match: RegExpExecArray, group: number) => {
    const [from, to] = match.indices![group]!;
    return source.slice(from, to);
  };
  for (const match of masked.matchAll(FROM)) {
    if (match[1] === undefined) found.push({ at: match.index, specifier: slice(match, 3) });
  }
  for (const match of masked.matchAll(SIDE_EFFECT)) found.push({ at: match.index, specifier: slice(match, 2) });
  for (const match of masked.matchAll(DYNAMIC)) found.push({ at: match.index, specifier: slice(match, 2) });
  for (const match of masked.matchAll(COMPUTED)) found.push({ at: match.index, specifier: COMPUTED_IMPORT });
  return found.sort((a, b) => a.at - b.at).map((f) => f.specifier);
}

/** One import that is not plain: the files from the entry point down to the importer, and what is wrong with the import. */
export type NonPlainImport = { files: string[]; reason: string };

/** `lanes-prune.ts → verapdf-containers.ts → test-stories-linux.ts → yaml` */
export const formatChain = ({ files, reason }: NonPlainImport): string => [...files.map((f) => basename(f)), reason].join(" → ");

const isRelative = (specifier: string) => specifier.startsWith("./") || specifier.startsWith("../");

/**
 * Every import reachable from `entries` that plain `node` could not load without installed
 * packages: anything but a Node builtin (`node:fs`, or a bare name such as `fs`) or a relative
 * `.ts` script, which is followed in turn. `read` returns a file's source, or undefined when it
 * does not exist; paths are posix, relative to the repository root. Each file is read once and
 * reported with the shortest chain from the entry point that reaches it.
 */
export function findNonPlainImports(entries: string[], read: (path: string) => string | undefined): NonPlainImport[] {
  const seen = new Set<string>();
  const found: NonPlainImport[] = [];
  for (const entry of entries) {
    if (seen.has(entry)) continue;
    seen.add(entry);
    const pending: string[][] = [[entry]];
    for (let next = 0; next < pending.length; next++) {
      const files = pending[next]!;
      const file = files.at(-1)!;
      const source = read(file);
      if (source === undefined) continue;
      for (const specifier of new Set(runtimeImports(source))) {
        if (specifier !== COMPUTED_IMPORT && isBuiltin(specifier)) continue;
        if (specifier === COMPUTED_IMPORT || !isRelative(specifier) || !specifier.endsWith(".ts")) {
          found.push({ files, reason: specifier });
          continue;
        }
        const target = normalize(join(dirname(file), specifier));
        if (seen.has(target)) continue;
        seen.add(target);
        if (read(target) === undefined) found.push({ files, reason: `${basename(target)} (missing)` });
        else pending.push([...files, target]);
      }
    }
  }
  return found;
}
