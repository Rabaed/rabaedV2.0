import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileVersionsVia } from "./git-files.ts";

// `pnpm check:uat-touch` (RP-1184): a text change in `apps/web/messages/*.json` can break a UAT case that
// finds the text on the page (RP-1221 and RP-1222 broke Round 0 cases and nobody knew until UAT failed).
// For every message the branch adds, changes or removes, this looks in `planning/uat/*/cases/*.ts` for a case
// that uses it, prints the case ids as a PR comment, and, given the PR body, requires a line
// "UAT cases touched: <ids>" naming every one.
//
// What counts as "uses it" (agreed with Main 7, who owns the harness; see the PR body):
// - the message key as a whole word in quotes ("home.title"), or
// - the visible text, before or after the change, found in the case's source: a message with no
//   placeholders matches whole; one with placeholders needs every literal piece of 3+ letters. Comparison
//   ignores case, runs of whitespace and the backslashes of string and regex escapes. A message under 4
//   characters is too common to match by text (only its key can).
// - or the case looks for a piece of the old text that the new text no longer has: a string literal, or the plain
//   run inside a regex literal, 6+ characters (a case that checks "We can't find this page" with a regex).
// - a match before the file's first `defineCase` (a helper in the case file) names `<FILE>-helpers`.
// Not looked at: `planning/uat/*/harness/*` (shared helpers) and a case that finds text by role or test id.
//
// Checked by `scripts/check-uat-touch.test.ts`, in the unit project.

export const messagesDir = "apps/web/messages";
export const touchedLine = /^[ \t>*-]*UAT cases touched:[ \t]*(.*)$/im;
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

/**
 * The pieces of text a case's source looks for: its string literals, and the plain runs inside its regex literals
 * (`/^Send for review\./` gives "Send for review"), 6+ characters with 4+ letters, normalized.
 */
export function searchedTexts(source: string): string[] {
  const strings = [...source.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
  const regexes = [...source.matchAll(/(?<=[(,:=]\s*)\/((?:[^/\\\n]|\\.)+)\/[a-z]*/g)].flatMap((m) => m[1]!.split(/\\[sSdDwWbB]|[\\.*+?()|[\]{}^$]+/));
  return [...new Set([...strings, ...regexes].map(normalize).map((t) => t.trim()))].filter((t) => t.length >= 6 && (t.match(/\p{L}/gu) ?? []).length >= 4);
}

/** Whether a case looks for text the change takes away: a piece it searches is in the old message and not in the new. */
export function textBroken(before: string | undefined, after: string | undefined, source: string): boolean {
  if (before === undefined) return false;
  const was = normalize(before);
  const now = after === undefined ? "" : normalize(after);
  return searchedTexts(source).some((t) => was.includes(t) && !now.includes(t));
}

/** Whether the case source names the key in quotes, as a whole dotted word. */
export function keyUsed(key: string, source: string): boolean {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`["'\`]${escaped}["'\`]`).test(source);
}

const defineCase = /defineCase\(\s*["'`]([^"'`]+)["'`]/g;

/** A case file split into its cases: the text before the first one belongs to `<FILE>-helpers`. */
export function casesOf(file: CaseFile): { id: string; file: string; source: string }[] {
  const stem = file.file.replace(/^.*[\\/]/, "").replace(/\.ts$/, "");
  const starts = [...file.text.matchAll(defineCase)].map((m) => ({ id: m[1]!, at: m.index }));
  const head = { id: `${stem}-helpers`, at: 0 };
  const all = starts[0]?.at === 0 ? starts : [head, ...starts];
  return all.map((s, i) => ({ id: s.id, file: file.file, source: file.text.slice(s.at, all[i + 1]?.at ?? file.text.length) }));
}

/** The cases that use any changed message, with the messages (`locale:key`) that made each one a hit; in case-id order. */
export function touchedCases(messages: Message[], files: CaseFile[]): CaseHit[] {
  const hits: CaseHit[] = [];
  for (const c of files.flatMap(casesOf)) {
    const used = messages.filter(
      (m) => keyUsed(m.key, c.source) || [m.before, m.after].some((value) => value !== undefined && textUsed(value, c.source)) ||
        textBroken(m.before, m.after, c.source),
    );
    if (used.length > 0) hits.push({ id: c.id, file: c.file, messages: [...new Set(used.map((m) => `${m.locale}:${m.key}`))] });
  }
  return hits.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
}

/** The case ids the body's "UAT cases touched:" line leaves out, or undefined when the body has no such line. */
export function missingFromBody(body: string, ids: string[]): string[] | undefined {
  const line = touchedLine.exec(body);
  if (!line) return undefined;
  const named = line[1]!;
  return ids.filter((id) => !new RegExp(`(?<![\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "i").test(named));
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

/** The case files, `planning/uat/<round>/cases/*.ts`, as the working tree has them. */
export function caseFiles(repo: string): CaseFile[] {
  const root = join(repo, "planning", "uat");
  return readdirSync(root, { withFileTypes: true })
    .filter((round) => round.isDirectory())
    .flatMap((round) => {
      const dir = join(root, round.name, "cases");
      try {
        return readdirSync(dir)
          .filter((f) => f.endsWith(".ts"))
          .sort()
          .map((f) => ({ file: `planning/uat/${round.name}/cases/${f}`, text: readFileSync(join(dir, f), "utf8") }));
      } catch {
        return [];
      }
    });
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  try {
    const args = process.argv.slice(2);
    const bodyFile = args[args.indexOf("--body-file") + 1];
    const body = args.includes("--body-file") && bodyFile ? readFileSync(bodyFile, "utf8") : undefined;
    const hits = touchedCases(branchMessages(process.cwd()), caseFiles(process.cwd()));
    const { ok, comment } = verdict(hits, body);
    if (comment) (ok ? console.log : console.error)(comment);
    else console.log("No UAT case uses a message this branch changes.");
    process.exitCode = ok ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
