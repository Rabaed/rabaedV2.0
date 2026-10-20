import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// `pnpm claims [--open] [--file <path>]` (RP-992): lists RP-603's shared-module claims (rule 12)
// without loading every comment into an agent's context (the raw issue is ~300 KB).
//
//   --open         only claims with no matching RELEASE
//   --file <path>  only claims whose text covers the path (named, a `dir/`, or a `scripts/x*.ts` glob)
//
// Environment: JIRA_EMAIL, JIRA_API_TOKEN (as .github/workflows/jira-close.yml). Reads comments only.
// An open claim whose PR merged is flagged, using `gh pr list` (skipped with a line saying so if gh fails).

const JIRA = "https://rabaedsa.atlassian.net";
const CLAIMS_ISSUE = "RP-603";

export interface Comment {
  id: number;
  /** ISO timestamp. */
  created: string;
  text: string;
}

export interface Claim {
  id: number;
  created: string;
  /** The ticket (or spec) that owns the claim, e.g. `RP-658`. */
  key: string | undefined;
  /** Other keys the claim is also posted under (a `spec RP-616` in the header). */
  keys: string[];
  lane: string | undefined;
  /** What is claimed, one trimmed line. */
  files: string;
  text: string;
  /** The RELEASE comment that closed it, if any. */
  releasedBy: number | undefined;
  /** PR numbers named in the claim that have merged since it was posted. */
  mergedPrs: number[];
}

export interface MergedPr {
  number: number;
  branch: string;
  title: string;
  mergedAt: string;
}

const KEY = /\bRP-\d+\b/g;
const keysIn = (text: string): string[] => [...new Set(text.match(KEY) ?? [])];

/** Comment ids a text refers to ("claims 14324 and 14333", "RELEASE 14200"): five or more digits, not a `#` PR or a part of a key or date. */
const commentIdsIn = (text: string): number[] => (text.match(/(?<![#\w-])\d{5,}\b/g) ?? []).map(Number);

/** A Jira comment body (Atlassian document, or already text) as plain text. */
export function bodyText(body: unknown): string {
  if (typeof body === "string") return body;
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as { type?: string; text?: string; content?: unknown[] };
    if (n.type === "text" && n.text) out.push(n.text);
    else if (n.type === "hardBreak") out.push("\n");
    else if (n.type === "inlineCard") out.push(" ");
    if (n.type === "listItem") out.push("\n- ");
    for (const child of n.content ?? []) walk(child);
    if (n.type === "paragraph" || n.type === "heading" || n.type === "codeBlock") out.push("\n");
  };
  walk(body);
  return out.join("").replace(/\n{2,}/g, "\n").trim();
}

/** Backslash escapes Jira adds to markdown (`scripts/lanes\*.ts`) read as the plain characters. */
const plain = (text: string): string => text.replace(/\\([*_`~[\]()#-])/g, "$1").replace(/`/g, "");

const kind = (text: string): "CLAIM" | "RELEASE" | undefined => /^(CLAIM|RELEASE)\b/.exec(text.trimStart())?.[1] as "CLAIM" | "RELEASE" | undefined;

/** The attribution `— Main 3, lane-3b, RP-623 …` of a claim: the keys and the lane. */
function attribution(text: string): { key: string | undefined; keys: string[]; lane: string | undefined } {
  const all = plain(text);
  // From the first "Main n" on, which sits on the first line unless the files were wrapped onto later lines.
  const scope = all.slice(Math.max(0, all.search(/\bMain \d\b/)));
  const key = keysIn(scope)[0];
  const spec = /\bspec (RP-\d+)/.exec(scope)?.[1];
  const keys = [...new Set([key, spec].filter((k): k is string => k !== undefined))];
  return { key, keys, lane: /\blane-\d[a-z]\b/.exec(scope)?.[0] };
}

/** What is claimed: the text between CLAIM and the attribution; the next lines when that is empty. */
function filesOf(text: string, max: number): string {
  const lines = plain(text).split("\n").map((l) => l.trim()).filter((l) => l !== "");
  let head = (lines[0] ?? "").replace(/^CLAIM\b[\s,:]*/, "");
  head = head.replace(/\s*[—–-]+\s*Main \d.*$/, "").replace(/^\(adds to \d+\)\s*/, "");
  if (head === "" || /^[—–-]/.test(head) || /^Main \d/.test(head)) head = lines.slice(1).join(" ");
  head = head.replace(/\s+/g, " ").trim();
  return head.length > max ? `${head.slice(0, max - 1)}…` : head;
}

/**
 * Claims in comment order, each with the RELEASE that closed it. A RELEASE closes an earlier claim when
 * it names the claim's comment id, or names the claim's key (or its spec's key). A claim posted after a
 * release is a new claim.
 */
export function readClaims(comments: Comment[], filesWidth = 70): Claim[] {
  const sorted = [...comments].sort((a, b) => a.id - b.id);
  const claims: Claim[] = [];
  for (const comment of sorted) {
    const type = kind(comment.text);
    if (type === "CLAIM") {
      const { key, keys, lane } = attribution(comment.text);
      claims.push({ id: comment.id, created: comment.created, key, keys, lane, files: filesOf(comment.text, filesWidth), text: plain(comment.text), releasedBy: undefined, mergedPrs: [] });
    } else if (type === "RELEASE") {
      const named = new Set(keysIn(comment.text));
      const ids = new Set(commentIdsIn(comment.text));
      for (const claim of claims) {
        if (claim.releasedBy !== undefined) continue;
        if (ids.has(claim.id) || claim.keys.some((k) => named.has(k))) claim.releasedBy = comment.id;
      }
    }
  }
  return claims;
}

/** A glob (`scripts/lane*.ts`) as a regex; `*` stays inside a path segment unless doubled. */
export const globRegex = (glob: string): RegExp => new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*\*|\*/g, (stars) => (stars === "**" ? ".*" : "[^/]*"))}$`);

/** Whether the claim's text covers `path`: named in it, under a named directory, or matched by a named glob. */
export function claimCovers(claim: Pick<Claim, "text">, path: string): boolean {
  const wanted = path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  const text = claim.text.replace(/\\/g, "/");
  // Named whole: `x.ts` is not found in `max.ts` or `x.tsx`, `scripts/db` not in `scripts/db-fn.ts`.
  if (new RegExp(`(?<![\\w./-])${wanted.replace(/[.+?^${}()|[\]\\*]/g, "\\$&")}(?![\\w-]|\\.\\w)`).test(text)) return true;
  for (const raw of text.split(/[\s,;()]+/)) {
    const token = raw.replace(/^[^\w@.*/-]+|[.:]+$/g, "");
    if (token === "" || !/[./]/.test(token)) continue;
    if (token.includes("*")) {
      if (globRegex(token).test(wanted)) return true;
    } else if (token.endsWith("/") ? wanted.startsWith(token) : wanted.startsWith(`${token}/`)) {
      return true;
    }
  }
  return false;
}

/** Marks open claims whose ticket's PR merged after the claim: a PR named in the claim, or a branch/title that starts with its key. */
export function flagMergedClaims(claims: Claim[], merged: MergedPr[]): void {
  for (const claim of claims) {
    if (claim.releasedBy !== undefined) continue;
    const named = new Set([...claim.text.matchAll(/\bPR #(\d+)/g)].map((m) => Number(m[1])));
    for (const pr of merged) {
      if (Date.parse(pr.mergedAt) <= Date.parse(claim.created)) continue;
      const byKey = claim.key !== undefined && (pr.branch.startsWith(`${claim.key}-`) || pr.branch === claim.key || pr.title.startsWith(`${claim.key}:`) || pr.title.startsWith(`${claim.key} `));
      if (named.has(pr.number) || byKey) claim.mergedPrs.push(pr.number);
    }
  }
}

/** One line per claim, newest last. */
export function formatClaims(claims: Claim[]): string {
  if (claims.length === 0) return "No claims.";
  const lines = claims.map((c) => {
    const state = c.releasedBy !== undefined ? `released ${c.releasedBy}` : c.mergedPrs.length > 0 ? `MERGED PR ${c.mergedPrs.map((n) => `#${n}`).join(",")}, NO RELEASE` : "OPEN";
    return `${c.id} ${(c.key ?? "?").padEnd(7)} ${(c.lane ?? "").padEnd(7)} ${state.padEnd(10)} ${c.files}`;
  });
  return lines.join("\n");
}

// --- Jira and gh ---

interface JiraComment {
  id: string;
  created: string;
  body: unknown;
}

export async function fetchComments(email: string, token: string, fetchImpl: typeof fetch = fetch): Promise<Comment[]> {
  const headers = { Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`, Accept: "application/json" };
  const comments: Comment[] = [];
  for (let start = 0; ; ) {
    const response = await fetchImpl(`${JIRA}/rest/api/3/issue/${CLAIMS_ISSUE}/comment?startAt=${start}&maxResults=100&orderBy=created`, { headers });
    // Status only: Jira's error text is not echoed.
    if (!response.ok) throw new Error(`Jira GET ${CLAIMS_ISSUE} comments answered ${response.status}`);
    const page = (await response.json()) as { comments: JiraComment[]; total: number };
    for (const c of page.comments) comments.push({ id: Number(c.id), created: c.created, text: bodyText(c.body) });
    start += page.comments.length;
    if (page.comments.length === 0 || start >= page.total) return comments;
  }
}

/** PRs merged recently, for the merged-without-RELEASE flag. */
function mergedPullRequests(): MergedPr[] {
  const out = execFileSync("gh", ["pr", "list", "--state", "merged", "--limit", "300", "--json", "number,headRefName,title,mergedAt"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return (JSON.parse(out) as { number: number; headRefName: string; title: string; mergedAt: string }[]).map((p) => ({ number: p.number, branch: p.headRefName, title: p.title, mergedAt: p.mergedAt }));
}

export function parseArgs(argv: string[]): { open: boolean; file: string | undefined } {
  let open = false;
  let file: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--open") open = true;
    else if (arg === "--file") {
      file = argv[++i];
      if (!file) throw new Error("--file needs a path");
    } else throw new Error("usage: pnpm claims [--open] [--file <path>]");
  }
  return { open, file };
}

async function main(): Promise<void> {
  const { open, file } = parseArgs(process.argv.slice(2));
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) throw new Error("Set JIRA_EMAIL and JIRA_API_TOKEN in your environment (see .env.example).");
  const claims = readClaims(await fetchComments(email, token));
  let skipped = "";
  try {
    flagMergedClaims(claims, mergedPullRequests());
  } catch {
    skipped = "\n(merged-PR flags skipped: `gh pr list` failed)";
  }
  const shown = claims.filter((c) => (!open || c.releasedBy === undefined) && (file === undefined || claimCovers(c, file)));
  const unreleased = claims.filter((c) => c.releasedBy === undefined).length;
  console.log(`${CLAIMS_ISSUE}: ${claims.length} claims, ${unreleased} open${file ? `; covering ${file}` : ""}\n${formatClaims(shown)}${skipped}`);
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
