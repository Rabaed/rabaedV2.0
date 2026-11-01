import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// `node scripts/check-gap-table.ts <file>... [--refs <folder>]` (RP-574): a gap table's citations checked, not
// trusted. The first workflow-builder gap table (spec RP-528) told the owner its reference outlined a
// selected Transition label, where the reference's CSS fills it (`.wl.sel{background:…}`), and read
// ADR 0017 as "no signatures" where it says every Transition is signed. The process and the table's
// format are in design/owner-reference-process.md.
//
// Every table with a "Reference source" column is a gap table. Each row:
//   - cites its reference source as `<file> › <part>`, the part a `css selector`, `line N`
//     (`lines N–M`) or `screenshot N` (a numbered screenshot of the reference); several citations split by `;`;
//   - has a Verdict: match, gap, rule-forced or question;
//   - when rule-forced, quotes the line that forces it in its Rule cell: `ADR 0017: "…"`,
//     `docs/visibility.md V14: "…"`, `GLOSSARY.md Step Age: "…"` or `CLAUDE.md: "…"`. Every quote in a
//     Rule cell must be in the file it names, word for word (spacing, emphasis and curly quotes aside).
// With --refs (the folder holding the owner's pages, e.g. D:\Artifacts), each cited file must be there,
// a selector must be in it and a line must exist. Without it, citations are checked for shape only.
// A selector is found in a `<style>` block and in CSS packed into a script string (RP-1209).

export interface GapTableOptions {
  /** The repository root, where the ADRs, docs/visibility.md, GLOSSARY.md and CLAUDE.md are read. */
  repo: string;
  /** The folder the reference files are cited from; undefined checks citations for shape only. */
  refs?: string | undefined;
}

const VERDICTS = ["match", "gap", "rule-forced", "question"];

const PARTS = "a `css selector`, `line N` or `screenshot N`";
const SOURCE_FORMAT = `\`<file> › <part>\`, the part ${PARTS}`;
/** The fewest words a rule quote has: "no" or "every" alone is in every file. */
const MIN_QUOTE_WORDS = 3;

/** A table row's cells, `\|` kept as a pipe inside its cell. */
function cells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  return inner.split(/(?<!\\)\|/).map((cell) => cell.trim().replaceAll("\\|", "|"));
}

const isTableLine = (line: string) => line.trim().startsWith("|");
const isSeparator = (line: string) => /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(line.trim());

interface Table {
  header: string[];
  rows: string[][];
}

/** Every markdown table in the text: a header line, a separator line, then its rows. */
function tables(markdown: string): Table[] {
  const lines = markdown.split(/\r?\n/);
  const found: Table[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!isTableLine(lines[i]!) || !isSeparator(lines[i + 1]!)) continue;
    const table: Table = { header: cells(lines[i]!), rows: [] };
    let j = i + 2;
    for (; j < lines.length && isTableLine(lines[j]!); j++) table.rows.push(cells(lines[j]!));
    found.push(table);
    i = j - 1;
  }
  return found;
}

const column = (header: string[], name: RegExp) => header.findIndex((cell) => name.test(cell));
const SOURCE_COLUMN = /reference source/i;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Text compared as words: spacing collapsed, markdown emphasis and code marks dropped, quotes straightened. */
const words = (text: string) =>
  text
    .replace(/[*`]/g, "")
    .replace(/(^|\W)_+|_+(?=\W|$)/g, "$1")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();

/** The repo file a rule label names, or why there is none. */
function ruleFile(label: string, repo: string): { file: string } | { error: string } {
  const adr = /\bADR\s*(\d{4})\b/i.exec(label)?.[1];
  if (adr) {
    const dir = join(repo, "docs/adr");
    const name = existsSync(dir) ? readdirSync(dir).find((entry) => entry.startsWith(`${adr}-`)) : undefined;
    return name ? { file: `docs/adr/${name}` } : { error: `ADR ${adr} is not in docs/adr` };
  }
  // A scenario from RP-nnn-1 on sits in its Jira key's own file (RP-1097); rows 1–81 and the rules in docs/visibility.md.
  const scenarios = /\bdocs\/visibility\/scenarios\/RP-\d+\.md\b/.exec(label)?.[0];
  if (scenarios) return existsSync(join(repo, scenarios)) ? { file: scenarios } : { error: `${scenarios} is not in the repo` };
  if (/\bvisibility\.md\b/i.test(label)) return { file: "docs/visibility.md" };
  if (/\bGLOSSARY\.md\b/i.test(label)) return { file: "GLOSSARY.md" };
  if (/\bCLAUDE\.md\b/i.test(label)) return { file: "CLAUDE.md" };
  return { error: "cites no rule source (ADR nnnn, docs/visibility.md, GLOSSARY.md or CLAUDE.md) before its quote" };
}

/** The problems with a Rule cell: each quote must sit in the file the text before it names. */
function ruleErrors(cell: string, ruleForced: boolean, repo: string): string[] {
  const quote = /"([^"]+)"|“([^”]+)”/g;
  const errors: string[] = [];
  let labelStart = 0;
  let quotes = 0;
  for (const match of cell.matchAll(quote)) {
    quotes++;
    const quoted = match[1] ?? match[2]!;
    const named = ruleFile(cell.slice(labelStart, match.index), repo);
    labelStart = match.index + match[0].length;
    if ("error" in named) {
      errors.push(`"${quoted}" ${named.error}`);
      continue;
    }
    const path = join(repo, named.file);
    const wanted = words(quoted);
    if (wanted.split(" ").length < MIN_QUOTE_WORDS) errors.push(`"${quoted}" is too short to show the rule; quote at least ${MIN_QUOTE_WORDS} words of its line`);
    else if (!existsSync(path)) errors.push(`"${quoted}": ${named.file} is not in the repo`);
    else if (!new RegExp(`(?<!\\w)${escapeRegExp(wanted)}(?!\\w)`).test(words(readFileSync(path, "utf8"))))
      errors.push(`"${quoted}" is not found in ${named.file}; quote its line word for word (a line holding straight quotes goes in curly quotes “…”)`);
  }
  if (ruleForced && quotes === 0) errors.push('is rule-forced but its Rule cell quotes no line: write `ADR nnnn: "<the line>"` (or docs/visibility.md, GLOSSARY.md, CLAUDE.md)');
  return errors;
}

const JS_ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r" };

/**
 * A script with its escapes read (RP-1209): some owner pages pack CSS into a string, each rule after a literal `\n`.
 * One pass, so `\\n` stays a backslash and an `n`; a `\` before a line break joins the lines.
 */
function unescapeScript(script: string): string {
  return script.replace(/\\(?:(\r?\n)|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|([\s\S]))/g, (_escape, lineBreak, unicode, hex, char) => {
    if (lineBreak !== undefined) return "";
    if (unicode !== undefined || hex !== undefined) return String.fromCharCode(parseInt(unicode ?? hex, 16));
    return JS_ESCAPES[char as string] ?? (char as string);
  });
}

/** The page as written, then each of its scripts unescaped, without block comments: the text a CSS rule's selector is looked for in. */
function searchableText(page: string): string {
  const scripts = [...page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => unescapeScript(match[1]!));
  return [page, ...scripts].join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Whether a CSS rule has the whole selector: `.wl.sel` is not found in `.wl.selected{…}` nor `.wl` in `.wl.sel{…}`. */
function hasRule(text: string, selector: string): boolean {
  const wanted = escapeRegExp(selector);
  // The first rule of a packed string follows its quote; there a rule must show its `{`, so `querySelectorAll(".a, .b")` is no rule.
  const inString = `["'\`]${wanted}(?:\\s*,[^"'\`{}]*)*\\s*\\{`;
  return new RegExp(`(?:(?:^|[\\s{},;>])${wanted}\\s*[{,])|(?:${inString})`, "m").test(text);
}

/** The problems with one `<file> › <part>` citation. */
function citationErrors(citation: string, refs: string | undefined): string[] {
  const match = /^([^`›]+?\.[A-Za-z0-9]+)\s*(?:›|>)\s*(.+)$/.exec(citation);
  if (!match) return [`cites "${citation}"; write ${SOURCE_FORMAT}`];
  const [, file, part] = match as unknown as [string, string, string];
  const selector = /^`(.+)`$/.exec(part)?.[1];
  const lines = /^lines?\s+(\d+)(?:\s*[–-]\s*(\d+))?$/i.exec(part);
  const screenshot = /^screenshot\s+\d+$/i.test(part);
  if (!selector && !lines && !screenshot) return [`cites "${part}" in ${file}; the part is ${PARTS}`];
  const first = Number(lines?.[1] ?? 1);
  const last = Number(lines?.[2] ?? first);
  if (lines && (first < 1 || last < first)) return [`cites ${part} of ${file}; lines count from 1, the first before the last`];
  if (refs === undefined) return [];
  const path = resolve(refs, file);
  if (relative(resolve(refs), path).startsWith("..")) return [`cites ${file}, outside ${refs}`];
  if (!existsSync(path)) return [`cites ${file}, not found in ${refs}`];
  const content = readFileSync(path, "utf8");
  // Lines are counted in the file as written, selectors looked for in its packed scripts too (RP-1209).
  if (selector && !hasRule(searchableText(content), selector)) return [`\`${selector}\` is not in ${file} as a CSS rule's selector`];
  if (lines) {
    const count = content.replace(/\r?\n$/, "").split(/\r?\n/).length;
    if (last > count) return [`cites line ${last} of ${file}, which has ${count} lines`];
  }
  return [];
}

/** Each problem in the file's gap tables, as `table t, row r: …`; empty when every row's citations hold. */
export function checkGapTable(markdown: string, options: GapTableOptions): string[] {
  const gapTables = tables(markdown).filter((table) => column(table.header, SOURCE_COLUMN) >= 0);
  if (gapTables.length === 0) return ["No gap table found: a gap table has the columns # | Element | Reference source | Built | Verdict | Proposal | Rule."];
  return gapTables.flatMap((table, t) => {
    const source = column(table.header, SOURCE_COLUMN);
    const verdict = column(table.header, /^verdict$/i);
    const rule = column(table.header, /^rule$/i);
    const number = column(table.header, /^#$/);
    const missing = [verdict < 0 && "Verdict", rule < 0 && "Rule"].filter(Boolean);
    if (missing.length > 0) return [`table ${t + 1}: no ${missing.join(" or ")} column`];
    return table.rows.flatMap((row, r) => {
      const at = `table ${t + 1}, row ${(number >= 0 && row[number]) || r + 1}`;
      const errors: string[] = [];
      const sourceCell = row[source] ?? "";
      if (sourceCell === "") errors.push(`has no reference source; cite ${SOURCE_FORMAT}`);
      else {
        const citations = sourceCell.split(/;(?=(?:[^`]*`[^`]*`)*[^`]*$)/).map((citation) => citation.trim());
        for (const citation of citations.filter(Boolean)) errors.push(...citationErrors(citation, options.refs));
      }
      const value = (row[verdict] ?? "").toLowerCase();
      if (!VERDICTS.includes(value)) errors.push(`has verdict "${row[verdict] ?? ""}"; use ${VERDICTS.join(", ")}`);
      errors.push(...ruleErrors(row[rule] ?? "", value === "rule-forced", options.repo));
      return errors.map((error) => `${at}: ${error}`);
    });
  });
}

/** The command line's table files and refs folder (`--refs <folder>` or `--refs=<folder>`, once), or what is wrong with it. */
export function parseArgs(args: string[]): { files: string[]; refs: string | undefined } | { error: string } {
  const files: string[] = [];
  let refs: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg !== "--refs" && !arg.startsWith("--refs=")) {
      files.push(arg);
      continue;
    }
    const value = arg === "--refs" ? args[++i] : arg.slice("--refs=".length);
    if (!value || value.startsWith("-")) return { error: "--refs needs the folder holding the owner's pages, such as D:\\Artifacts." };
    if (refs !== undefined) return { error: "--refs is given twice; give one folder." };
    refs = value;
  }
  return files.length === 0 ? { error: "No gap table given." } : { files, refs };
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(parsed.error);
    console.error("Usage: node scripts/check-gap-table.ts <gap table .md>... [--refs <folder with the reference files>]");
    process.exit(2);
  }
  const { files, refs } = parsed;
  if (refs !== undefined && !existsSync(refs)) {
    console.error(`--refs ${refs}: no such folder.`);
    process.exit(2);
  }
  let failed = false;
  for (const file of files) {
    if (!existsSync(file)) {
      console.error(`${file}: no such file.`);
      failed = true;
      continue;
    }
    const errors = checkGapTable(readFileSync(file, "utf8"), { repo: process.cwd(), refs });
    if (errors.length === 0) {
      console.log(`${file}: every row cites its source${refs ? ` (checked in ${refs})` : " (shape only: pass --refs to check the reference files)"}.`);
      continue;
    }
    failed = true;
    console.error(`${file}: the gap table's citations don't hold (design/owner-reference-process.md):`);
    for (const error of errors) console.error(`  ${error}`);
  }
  if (failed) process.exit(1);
}
