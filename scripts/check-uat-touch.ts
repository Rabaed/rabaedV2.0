import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileVersionsVia } from "./git-files.ts";

// `pnpm check:uat-touch` (RP-1184): a text change in `apps/web/messages/*.json` can break a UAT case that
// finds the text on the page (RP-1221 and RP-1222 broke Round 0 cases and nobody knew until UAT failed).
// For every message the branch adds, changes or removes, this looks in `planning/uat/*/cases/*.ts` for a case
// that uses it, prints the case ids as a PR comment, and, given the PR body, requires a line
// "UAT cases touched: <ids>" naming every one.
//
// What counts as "uses it" (proposed to Main 7, who owns the harness; see the PR body):
// - the message key as a whole word in quotes ("home.title"), or
// - the visible text, before or after the change, found in the case's source: a message with no
//   placeholders matches whole; one with placeholders needs every literal piece of 3+ letters. Comparison
//   ignores case, runs of whitespace and the backslashes of string and regex escapes. A message under 4
//   characters is too common to match by text (only its key can).
// - or the case looks for text the new message no longer has: a string literal inside the old text, or a regex literal
//   that matches the old text and not the new (a case that checks /We can.t find this page/).
// - a match before a case file's first `defineCase` (a helper in the case file) names `<FILE>-helpers`.
// - `planning/uat/*/harness/*.ts` is scanned too (helpers look for UI text themselves) and reports as `harness/<file>`;
//   a role query's `name` string or regex is searched like any other text (a test id has none).
// - `planning/uat/*/test-cases.json` (RP-1234, the person-run sheet) is scanned too: each Test Case is one unit named by
//   its id, and only its `title`, `steps` and `expected` are searched (the words a tester looks for), with the same rules.
//   A Test Case and a `defineCase` block with the same id (SUB-01 is in both) are one hit naming both files.
// Not looked at: text assembled from several keys.
//
// Checked by `scripts/check-uat-touch.test.ts`, in the unit project.

export const messagesDir = "apps/web/messages";
// The line and the lines wrapped under it, up to a blank line.
export const touchedLine = /^[ \t>*-]*UAT cases touched:[ \t]*([^\n]*(?:\n(?![ \t]*\r?\n)[^\n]*)*)/im;
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** First line of the PR comment, so a workflow can find and update its own comment. */
export const commentTag = "<!-- uat-touch -->";

export type Message = { key: string; locale: string; before: string | undefined; after: string | undefined };
export type CaseFile = { file: string; text: string };
export type CaseHit = { id: string; file: string; messages: string[] };

/** `{ a: { b: "x" } }` as `a.b` → "x"; arrays use their index. Non-string leaves are ignored. */
export function flattenMessages(value: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof value === "string") out.set(prefix, value);
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) for (const [kk, vv] of flattenMessages(v, prefix ? `${prefix}.${k}` : k)) out.set(kk, vv);
  return out;
}

/** The messages one locale file adds, changes or removes between `before` and `after` (JSON text, undefined = no file). */
export function changedMessages(locale: string, before: string | undefined, after: string | undefined): Message[] {
  const was = flattenMessages(before === undefined ? {} : JSON.parse(before));
  const now = flattenMessages(after === undefined ? {} : JSON.parse(after));
  return [...new Set([...was.keys(), ...now.keys()])]
    .filter((key) => was.get(key) !== now.get(key))
    .sort()
    .map((key) => ({ key, locale, before: was.get(key), after: now.get(key) }));
}

const normalize = (text: string) => text.replace(/\\([^\w\s])/g, "$1").replace(/\s+/g, " ").toLowerCase();

/** The literal pieces of a message (ICU placeholders and plural syntax left out) that are 3+ letters. */
export function literalPieces(value: string): string[] {
  return value
    .replace(/\{\s*[\w.]+\s*,\s*(?:plural|select|selectordinal)\s*,/g, "\0") // `{count, plural,`
    .replace(/\{\s*[\w.]+\s*(?:,[^{}]*)?\}/g, "\0") // `{name}`, `{when, date, short}`
    .replace(/(?:\b(?:zero|one|two|few|many|other)|=\d+)\s*\{/g, "\0") // a plural variant's `one {`
    .split(/[\0{}#]/)
    .map((piece) => piece.replace(/\s+/g, " ").trim())
    .filter((piece) => (piece.match(/\p{L}/gu) ?? []).length >= 3);
}

/** Whether one message text is used by a case's source. */
export function textUsed(value: string, source: string): boolean {
  if (value.trim().length < 4) return false;
  const text = normalize(source);
  if (!/[{}]/.test(value)) return text.includes(normalize(value.trim()));
  const pieces = literalPieces(value);
  return pieces.length > 0 && pieces.every((piece) => text.includes(normalize(piece)));
}

/** What a case's source looks for on the page: its string literals, and its regex literals as RegExps; 6+ characters, 4+ letters. */
export function searchedTexts(source: string): { strings: string[]; regexes: RegExp[] } {
  const long = (t: string) => t.length >= 6 && (t.match(/\p{L}/gu) ?? []).length >= 4;
  const strings = [...source.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)].map((m) => normalize(m[1] ?? m[2] ?? m[3] ?? "").trim());
  const regexes = [...source.matchAll(/(?<=[(,:=|&!?]\s*)\/((?:[^/\\\n]|\\.)+)\/([a-z]*)/g)].flatMap((m) => {
    // A pattern from a PR's case file runs in CI: refuse the nested-quantifier shapes that backtrack without end.
    if (!long(m[1]!) || m[1]!.length > 300 || /\([^)]*[+*][^)]*\)[+*{]/.test(m[1]!)) return [];
    try {
      return [new RegExp(m[1]!, m[2]!.replace(/[^imsu]/g, ""))];
    } catch {
      return [];
    }
  });
  return { strings: [...new Set(strings.filter(long))], regexes };
}

/** Whether a case looks for text the change takes away: a piece or pattern it searches is in the old message and not in the new. */
export function textBroken(before: string | undefined, after: string | undefined, source: string): boolean {
  if (before === undefined) return false;
  const was = normalize(before);
  const now = after === undefined ? "" : normalize(after);
  const { strings, regexes } = searchedTexts(source);
  return strings.some((t) => was.includes(t) && !now.includes(t)) || regexes.some((r) => r.test(before) && !r.test(after ?? ""));
}

/** Whether the case source names the key in quotes, as a whole dotted word. */
export function keyUsed(key: string, source: string): boolean {
  return new RegExp(`["'\`]${escapeRegExp(key)}["'\`]`).test(source);
}

const defineCase = /defineCase\(\s*["'`]([^"'`]+)["'`]/g;

// The fields of a Test Case in `test-cases.json` that hold the words a tester looks for (RP-1234). The rest
// (jira, part, partName, who, priority, mode, waits, covers, needs) is bookkeeping; partName is a bare tab name
// that would match its message by accident.
const sheetFields = ["title", "steps", "expected"];

/** The person-run sheet, `test-cases.json`: a list of Test Cases, each one unit named by its id like a `defineCase` block. */
function sheetCases(file: CaseFile): { id: string; file: string; source: string }[] {
  let list: unknown;
  try {
    list = JSON.parse(file.text);
  } catch (error) {
    throw new Error(`${file.file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry: unknown) => {
    const testCase = (entry ?? {}) as Record<string, unknown>;
    if (typeof testCase.id !== "string") return [];
    const source = sheetFields.flatMap((field) => (typeof testCase[field] === "string" ? [testCase[field] as string] : [])).join("\n");
    return [{ id: testCase.id, file: file.file, source }];
  });
}

/** A case file split into its cases: the text before the first one belongs to `<FILE>-helpers`. */
export function casesOf(file: CaseFile): { id: string; file: string; source: string }[] {
  if (/(?:^|[\\/])test-cases\.json$/.test(file.file)) return sheetCases(file);
  const stem = file.file.replace(/^.*[\\/]/, "").replace(/\.ts$/, "");
  const starts = [...file.text.matchAll(defineCase)].map((m) => ({ id: m[1]!, at: m.index }));
  const head = { id: /[\\/]harness[\\/]/.test(file.file) ? `harness/${stem}` : `${stem}-helpers`, at: 0 };
  const all = starts[0]?.at === 0 ? starts : [head, ...starts];
  return all.map((s, i) => ({ id: s.id, file: file.file, source: file.text.slice(s.at, all[i + 1]?.at ?? file.text.length) }));
}

/** The cases that use any changed message, with the messages (`locale:key`) that made each one a hit; in case-id order. */
export function touchedCases(messages: Message[], files: CaseFile[]): CaseHit[] {
  const byId = new Map<string, CaseHit>();
  for (const c of files.flatMap(casesOf)) {
    const used = messages.filter(
      (m) => keyUsed(m.key, c.source) || [m.before, m.after].some((value) => value !== undefined && textUsed(value, c.source)) ||
        textBroken(m.before, m.after, c.source),
    );
    if (used.length === 0) continue;
    // The person-run sheet and the automated case share an id (SUB-01 is in both): one hit, with both files.
    const seen = byId.get(c.id);
    const names = used.map((m) => `${m.locale}:${m.key}`);
    if (!seen) byId.set(c.id, { id: c.id, file: c.file, messages: [...new Set(names)] });
    else {
      if (!seen.file.split(", ").includes(c.file)) seen.file += `, ${c.file}`;
      seen.messages = [...new Set([...seen.messages, ...names])];
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
}

/** The case ids the body's "UAT cases touched:" line leaves out, or undefined when the body has no such line. */
export function missingFromBody(body: string, ids: string[]): string[] | undefined {
  const line = touchedLine.exec(body);
  if (!line) return undefined;
  const named = line[1]!;
  return ids.filter((id) => !new RegExp(`(?<![\\w-])${escapeRegExp(id)}(?![\\w-])`, "i").test(named));
}

/** What to say: the PR comment (with its marker) and whether the branch passes. `body` undefined = report only. */
export function verdict(hits: CaseHit[], body: string | undefined): { ok: boolean; comment: string } {
  if (hits.length === 0) return { ok: true, comment: "" };
  const ids = hits.map((h) => h.id);
  const missing = body === undefined ? [] : (missingFromBody(body, ids) ?? ids);
  const list = hits.map((h) => `- \`${h.id}\` (${h.file}): ${h.messages.map((m) => `\`${m}\``).join(", ")}`).join("\n");
  const ask =
    missing.length === 0
      ? ""
      : `\n\nAdd a line to the PR body naming ${missing.length === ids.length ? "them" : `the missing ones (${missing.join(", ")})`}, saying what you did about each (case updated, or still passes):\n\n\`UAT cases touched: ${ids.join(", ")}\``;
  return {
    ok: missing.length === 0,
    comment: `${commentTag}\n**UAT cases touched** by the message changes in this PR (RP-1184). A text change can break a case that finds the text on the page:\n\n${list}${ask}`,
  };
}

/** Every message the branch changes in `apps/web/messages/*.json`, at `commit` against the merge base with origin/main. */
export function branchMessages(repo: string, commit = "HEAD", spawn: typeof spawnSync = spawnSync): Message[] {
  const versions = fileVersionsVia(repo, spawn);
  return readdirSync(join(repo, messagesDir))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) => {
      const { before, after } = versions(commit, `${messagesDir}/${f}`);
      return changedMessages(f.replace(/\.json$/, ""), before, after);
    });
}

/** The case files and the harness helpers they share, `planning/uat/<round>/{cases,harness}/*.ts`, and each round's person-run sheet, `test-cases.json`, as the working tree has them. */
export function caseFiles(repo: string): CaseFile[] {
  const root = join(repo, "planning", "uat");
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((round) => round.isDirectory())
    .flatMap((round) => {
      const sheet = join(root, round.name, "test-cases.json");
      const sheets = existsSync(sheet) ? [{ file: `planning/uat/${round.name}/test-cases.json`, text: readFileSync(sheet, "utf8") }] : [];
      const scripts = ["cases", "harness"].flatMap((folder) => {
        const dir = join(root, round.name, folder);
        if (!existsSync(dir)) return [];
        return readdirSync(dir)
          .filter((f) => f.endsWith(".ts"))
          .sort()
          .map((f) => ({ file: `planning/uat/${round.name}/${folder}/${f}`, text: readFileSync(join(dir, f), "utf8") }));
      });
      return [...scripts, ...sheets];
    });
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  try {
    const args = process.argv.slice(2);
    const at = args.indexOf("--body-file");
    const bodyFile = args[at + 1];
    if (at >= 0 && !bodyFile) throw new Error("--body-file needs the path of a file holding the PR body.");
    const body = at >= 0 ? readFileSync(bodyFile!, "utf8") : undefined;
    const hits = touchedCases(branchMessages(process.cwd()), caseFiles(process.cwd()));
    const { ok, comment } = verdict(hits, body);
    // Always stdout: a workflow posts what is printed, most of all when the check fails.
    if (comment) console.log(comment);
    else console.log("No UAT case uses a message this branch changes.");
    process.exitCode = ok ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
