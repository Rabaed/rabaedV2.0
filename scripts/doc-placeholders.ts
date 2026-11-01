import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// A `<word>` placeholder in a command the docs show is a trap: PowerShell reads
// `<` as a redirect, so a pasted `pnpm lane:done <pr> --yes` fails (RP-1198).
// The docs write a real value (`pnpm lane:done 580 --yes`) or name the value in
// prose. This finds the placeholders in:
//   - fenced code blocks that are untagged or tagged as a shell (the docs tag
//     none of their command fences, so an untagged fence is a command), and
//   - inline code spans that start with `pnpm`, `node`, `git`, `gh` or `docker`.
// A placeholder inside a quoted string is fine (PowerShell does not redirect
// there), and so are fences of any other language (mermaid, json, ts, ...).
//
// The docs that still have placeholders are listed in
// `doc-placeholders-baseline.json`; the list only shrinks. Checked by
// `scripts/doc-placeholders.test.ts` in `pnpm test:unit` and on docs-only PRs.

export type PlaceholderHit = { kind: "fence" | "inline"; code: string; line: number };
/** Doc path (repo-relative, `/`) to the exact code text of each hit; a repeat is listed again. */
export type PlaceholderBaseline = Record<string, string[]>;

// An untagged fence, or a shell's tag. Anything else is code in another language.
const SHELL_TAGS = new Set(["", "bash", "sh", "shell", "zsh", "console", "powershell", "pwsh", "ps1", "ps"]);
const COMMAND_SPAN = /^(?:\$ )?(?:pnpm|node|git|gh|docker)(?=\s)/;
const HTML_TAGS = new Set(["br", "hr", "div", "span", "details", "summary", "kbd", "sup", "sub", "code", "pre", "img"]);

// `<word>`, `<two words>`, `<a-b>`: a letter first, then words of letters,
// digits, `_`, `.` and `-` split by single spaces. That leaves `<=`, `<<`, `->`,
// `< in.txt` and `<br/>` out, and `rp<n>` in (a redirect all the same).
const PLACEHOLDER = /<([A-Za-z][\w.-]*(?: [\w.-]+)*)>/g;

function hasPlaceholder(code: string): boolean {
  const unquoted = code.replace(/"[^"]*"|'[^']*'/g, "");
  return [...unquoted.matchAll(PLACEHOLDER)].some((m) => !HTML_TAGS.has(m[1]!.toLowerCase()));
}

const FENCE_OPEN = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/;
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;
const SPAN = /(`+)(.+?)\1(?!`)/g;

/** Each placeholder in a shell command the text shows: one hit per code line or span, with its 1-based line. */
export function placeholderHits(markdown: string): PlaceholderHit[] {
  const hits: PlaceholderHit[] = [];
  let open: { fenceMark: string; shell: boolean } | undefined;
  markdown.split("\n").forEach((rawLine, i) => {
    const line = rawLine.replace(/\r$/, "");
    if (open !== undefined) {
      const close = FENCE_CLOSE.exec(line)?.[1];
      if (close !== undefined && close[0] === open.fenceMark[0] && close.length >= open.fenceMark.length) open = undefined;
      else if (open.shell && hasPlaceholder(line)) hits.push({ kind: "fence", code: line.trim(), line: i + 1 });
      return;
    }
    const opening = FENCE_OPEN.exec(line);
    if (opening !== null) {
      open = { fenceMark: opening[1]!, shell: SHELL_TAGS.has(opening[2]!.toLowerCase()) };
      return;
    }
    for (const span of line.matchAll(SPAN)) {
      const code = span[2]!.trim();
      if (COMMAND_SPAN.test(code) && hasPlaceholder(code)) hits.push({ kind: "inline", code, line: i + 1 });
    }
  });
  return hits;
}

/** The docs checked, repo-relative with `/`: `CLAUDE.md`, and every `.md` under `planning/` and `docs/`. */
export function placeholderDocs(repo: string): string[] {
  const under = (folder: string) =>
    existsSync(join(repo, folder))
      ? readdirSync(join(repo, folder), { recursive: true, encoding: "utf8" })
          .filter((f) => f.endsWith(".md"))
          .map((f) => `${folder}/${f.replaceAll("\\", "/")}`)
      : [];
  return ["CLAUDE.md", ...under("planning"), ...under("docs")].filter((f) => existsSync(join(repo, f))).sort();
}

/**
 * RP-1198 review P4: one message per entry of the baseline `now` that origin/main's (`main`) does not have,
 * a second copy of one included: the list only shrinks. ci-green.ts holds a PR whose baseline gains one to the stamped verify.
 */
export function baselineGains(main: PlaceholderBaseline, now: PlaceholderBaseline): string[] {
  const gains: string[] = [];
  for (const doc of Object.keys(now).sort()) {
    const left = new Map<string, number>();
    for (const code of main[doc] ?? []) left.set(code, (left.get(code) ?? 0) + 1);
    for (const code of now[doc] ?? []) {
      const n = left.get(code) ?? 0;
      if (n > 0) left.set(code, n - 1);
      else gains.push(`${doc}: ${code} (scripts/doc-placeholders-baseline.json on origin/main does not list it: the list only shrinks; fix the doc instead)`);
    }
  }
  return gains;
}

/**
 * One message per hit the baseline does not list, and one per baseline entry
 * that no longer matches a hit (delete it: the list only shrinks).
 */
export function placeholderProblems(repo: string, docs: string[], baseline: PlaceholderBaseline): string[] {
  const problems: string[] = [];
  for (const doc of [...new Set([...docs, ...Object.keys(baseline)])].sort()) {
    const hits = docs.includes(doc) ? placeholderHits(readFileSync(join(repo, doc), "utf8")) : [];
    const allowed = new Map<string, number>();
    for (const code of baseline[doc] ?? []) allowed.set(code, (allowed.get(code) ?? 0) + 1);
    for (const hit of hits) {
      const left = allowed.get(hit.code) ?? 0;
      if (left > 0) allowed.set(hit.code, left - 1);
      else {
        const where = hit.kind === "fence" ? "a code block" : "inline code";
        problems.push(`${doc}:${hit.line} has a <placeholder> in ${where}: ${hit.code} (PowerShell reads < as a redirect: write a real value, or say it in prose)`);
      }
    }
    for (const [code, left] of allowed) {
      for (let n = 0; n < left; n++) {
        problems.push(`${doc}: scripts/doc-placeholders-baseline.json lists ${code}, which the doc no longer has: delete that entry`);
      }
    }
  }
  return problems;
}
