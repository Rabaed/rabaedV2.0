import { resolve } from "node:path";
import { jiraOverHttp } from "./jira-close.ts";

// `node scripts/spec-stories.ts RP-nnn [--close]` (RP-1102): checks that every User Story and every
// visibility scenario a spec numbers is named by at least one Jira task under the spec's Epic that names
// the spec. Spec RP-632's story 57 and spec RP-649's story 32 had no task, and nobody noticed until the
// epic review (RP-1087, RP-1081).
//
//   (no flag)   prints each story and scenario with the tasks that name it; exits 1 when one has none
//   --close     also moves the spec to Done, with a comment, but only when nothing is missing
//
// What counts:
//   - Stories: the numbered lines under the spec's "User Stories" heading ("13. As a …"), up to the next
//     heading of the same level. Sub-headings and bold group labels inside it are fine.
//   - Scenarios: every `RP-nnn-n` the spec names, with "RP-23-1 to RP-23-5" read as a range.
//   - A task names the spec when its summary or description has the spec's key (or one of its scenario
//     ids). It names a story with "story 32", "stories 1–4, 7 and 9" or a "Stories: 1, 2" line, and a
//     scenario by its id. Any status counts: a task closed as won't do still answers for its stories.
//   - Only tasks whose parent is the spec's Epic are read, so a story number written for another spec of
//     another Epic is not taken.
//
// Environment: JIRA_EMAIL, JIRA_API_TOKEN (as `pnpm claims`). The token goes only in the Authorization
// header; Jira's error text is never printed, only its status. Reads issues; writes only with --close.

const JIRA = "https://rabaedsa.atlassian.net";
const SPEC_LABEL = "spec";

/** A Jira issue as this check reads it: the description already flattened to text. */
export interface Issue {
  key: string;
  summary: string;
  text: string;
  labels: string[];
  status: string;
  /** "new", "indeterminate" or "done". */
  statusCategory: string;
  /** The parent's key (the Epic, for a spec or a task). */
  parent: string | undefined;
}

// --- Atlassian document format to text ---

const INLINE = new Set(["text", "hardBreak", "mention", "emoji", "inlineCard", "date", "status", "mediaInline", "placeholder"]);

interface AdfNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
}

function inline(nodes: AdfNode[] | undefined): string {
  let out = "";
  for (const node of nodes ?? []) {
    if (node.type === "text") out += node.text ?? "";
    else if (node.type === "hardBreak") out += "\n";
    else if (node.type === "inlineCard") out += String(node.attrs?.url ?? "");
    else if (node.attrs && typeof node.attrs.text === "string") out += node.attrs.text;
    else out += inline(node.content);
  }
  return out;
}

const listLines = (prefix: string, lines: string[]): string[] => (lines.length === 0 ? [prefix.trimEnd()] : [`${prefix}${lines[0]}`, ...lines.slice(1).map((line) => `  ${line}`)]);

function blocks(nodes: AdfNode[] | undefined): string[] {
  const out: string[] = [];
  for (const node of nodes ?? []) {
    switch (node.type) {
      case "heading":
        out.push(`${"#".repeat(Number(node.attrs?.level ?? 1))} ${inline(node.content)}`);
        break;
      case "paragraph":
      case "codeBlock":
        out.push(...inline(node.content).split("\n"));
        break;
      case "bulletList":
        for (const child of node.content ?? []) out.push(...listLines("- ", blocks(child.content)));
        break;
      case "orderedList": {
        const start = Number(node.attrs?.order ?? 1);
        (node.content ?? []).forEach((child, i) => out.push(...listLines(`${start + i}. `, blocks(child.content))));
        break;
      }
      case "rule":
        break;
      default:
        if (node.type !== undefined && INLINE.has(node.type)) out.push(...inline([node]).split("\n"));
        else out.push(...blocks(node.content));
    }
  }
  return out;
}

/** An issue's description (Atlassian document format, or already a string) as text: headings as `## …`, ordered lists keeping their numbers. */
export function adfText(body: unknown): string {
  if (typeof body === "string") return body;
  if (!body || typeof body !== "object") return "";
  return blocks((body as AdfNode).content).join("\n").trim();
}

// --- What a spec numbers, and what a task names ---

/** The story numbers of a spec: numbered lines under "User Stories", nested list lines excluded. */
export function specStories(text: string): number[] {
  const found = new Set<number>();
  let level: number | undefined;
  for (const line of text.split("\n")) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const depth = heading[1]?.length ?? 0;
      if (level !== undefined && depth <= level) level = undefined;
      if (level === undefined && /^\**\s*User Stories\b/i.test(heading[2] ?? "")) level = depth;
      continue;
    }
    if (level === undefined) continue;
    const story = /^(\d+)\\?[.)]\s+\S/.exec(line);
    if (story) found.add(Number(story[1]));
  }
  return [...found].sort((a, b) => a - b);
}

/** A range wider than this is a typo or a different number, not a list of stories. */
const MAX_RANGE = 200;

function expand(from: number, to: number): number[] {
  if (to < from || to - from > MAX_RANGE) return [];
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** Scenario ids (`RP-23-1`) a text names, "RP-23-1 to RP-23-5" and "RP-23-1–5" read as ranges, sorted by key then number. */
export function scenarioIds(text: string): string[] {
  const found = new Set<string>();
  const id = /(?<![\w-])(RP-\d+)-(\d+)(?![\w-])(?:\s*(?:to|–|—|…|\.\.\.?)\s*(?:\1-)?(\d+)(?![\w-]))?/g;
  for (const match of text.matchAll(id)) {
    const [, key, first, last] = match;
    const numbers = last === undefined ? [Number(first)] : expand(Number(first), Number(last));
    for (const n of numbers) found.add(`${key}-${n}`);
  }
  const order = (s: string) => s.split("-").map(Number);
  return [...found].sort((a, b) => {
    const [, ka = 0, na = 0] = order(a);
    const [, kb = 0, nb = 0] = order(b);
    return ka - kb || na - nb;
  });
}

export const namedScenarios = scenarioIds;

/** Story numbers a task names: "story 32", "stories 1–4, 7 and 9", "Stories: 1, 2", "stories 40 to 41". */
export function namedStories(text: string): number[] {
  const found = new Set<number>();
  const part = String.raw`\d+(?:\s*(?:-|–|—|to)\s*\d+)?`;
  const list = new RegExp(String.raw`\bstor(?:y|ies)\b\s*[:#]?\s*(${part}(?:\s*(?:,|&|\band\b)\s*${part})*)`, "gi");
  for (const match of text.matchAll(list)) {
    for (const piece of (match[1] ?? "").split(/\s*(?:,|&|\band\b)\s*/)) {
      const range = /^(\d+)\s*(?:-|–|—|to)\s*(\d+)$/.exec(piece);
      if (range) expand(Number(range[1]), Number(range[2])).forEach((n) => found.add(n));
      else if (/^\d+$/.test(piece)) found.add(Number(piece));
    }
  }
  return [...found].sort((a, b) => a - b);
}

/** Whether a text names the spec's key (or one of its scenario ids), and not a longer key. */
export function namesSpec(text: string, specKey: string): boolean {
  return new RegExp(String.raw`(?<![\w-])${specKey}(?!\d)`).test(text);
}

// --- The check ---

export interface Named<T> {
  id: T;
  /** Keys of the tasks that name it, sorted. */
  by: string[];
}

export interface SpecReport {
  spec: Issue;
  stories: Named<number>[];
  scenarios: Named<string>[];
  missingStories: number[];
  missingScenarios: string[];
  /** Tasks under the Epic that name the spec. */
  children: string[];
  /** Those of them not Done yet (information only). */
  openIssues: string[];
  ok: boolean;
}

export function checkSpec(spec: Issue, candidates: Issue[]): SpecReport {
  const children = candidates.filter((c) => c.key !== spec.key && namesSpec(`${c.summary}\n${c.text}`, spec.key)).sort((a, b) => keyNumber(a.key) - keyNumber(b.key));
  const told = children.map((c) => {
    const body = `${c.summary}\n${c.text}`;
    return { key: c.key, stories: new Set(namedStories(body)), scenarios: new Set(namedScenarios(body)) };
  });
  const stories = specStories(spec.text).map((id) => ({ id, by: told.filter((t) => t.stories.has(id)).map((t) => t.key) }));
  const scenarios = scenarioIds(spec.text).map((id) => ({ id, by: told.filter((t) => t.scenarios.has(id)).map((t) => t.key) }));
  const missingStories = stories.filter((s) => s.by.length === 0).map((s) => s.id);
  const missingScenarios = scenarios.filter((s) => s.by.length === 0).map((s) => s.id);
  return {
    spec,
    stories,
    scenarios,
    missingStories,
    missingScenarios,
    children: children.map((c) => c.key),
    openIssues: children.filter((c) => c.statusCategory !== "done").map((c) => c.key),
    ok: missingStories.length === 0 && missingScenarios.length === 0,
  };
}

const keyNumber = (key: string) => Number(key.replace(/^RP-/, ""));
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function formatReport(report: SpecReport): string {
  const { spec } = report;
  const lines = [`${spec.key}: ${count(report.stories.length, "story", "stories")}, ${count(report.scenarios.length, "scenario", "scenarios")}, ${count(report.children.length, "issue", "issues")} naming the spec (under ${spec.parent ?? "no Epic"})`];
  if (report.stories.length === 0 && report.scenarios.length === 0) lines.push("  No numbered stories and no RP-nnn-n scenarios in the spec.");
  for (const s of report.stories) lines.push(`  story ${s.id}: ${s.by.length > 0 ? s.by.join(", ") : "named by no issue"}`);
  for (const s of report.scenarios) lines.push(`  ${s.id}: ${s.by.length > 0 ? s.by.join(", ") : "named by no issue"}`);
  if (report.openIssues.length > 0) lines.push(`Not Done yet: ${report.openIssues.join(", ")}`);
  if (report.ok) {
    lines.push(`OK: every story and scenario of ${spec.key} is named by an issue.`);
  } else {
    const parts = [report.missingStories.length > 0 ? count(report.missingStories.length, "story", "stories") : "", report.missingScenarios.length > 0 ? count(report.missingScenarios.length, "scenario", "scenarios") : ""].filter((p) => p !== "");
    const single = parts.length === 1 && (report.missingStories.length + report.missingScenarios.length === 1);
    lines.push(`FAIL: ${parts.join(" and ")} ${single ? "is" : "are"} named by no issue. Write each in the issue that builds it ("Stories: n, m" in its description), or open an issue for it.`);
  }
  return lines.join("\n");
}

// --- Command line ---

export function parseArgs(argv: string[]): { key: string; close: boolean } {
  // eslint-disable-next-line rabaed/no-avoid-terms -- `node` is the Node.js command that runs the script
  const usage = "usage: node scripts/spec-stories.ts RP-nnn [--close]";
  let key: string | undefined;
  let close = false;
  for (const arg of argv) {
    if (arg === "--close") close = true;
    else if (/^RP-\d+$/.test(arg) && key === undefined) key = arg;
    else throw new Error(usage);
  }
  if (key === undefined) throw new Error(usage);
  return { key, close };
}

/** The Jira calls the check makes, so tests can stand in for Jira. */
export interface SpecJira {
  issue(key: string): Promise<Issue>;
  issuesUnder(epic: string, specKey: string): Promise<Issue[]>;
  closeWithComment(key: string, comment: string): Promise<void>;
}

export async function run(args: { key: string; close: boolean }, jira: SpecJira): Promise<{ exitCode: number; output: string }> {
  const spec = await jira.issue(args.key);
  if (args.close && !spec.labels.includes(SPEC_LABEL)) return { exitCode: 1, output: `${spec.key} has no \`${SPEC_LABEL}\` label: --close closes only specs. Close other issues as usual.` };
  if (args.close && spec.statusCategory === "done") return { exitCode: 1, output: `${spec.key} is already Done (${spec.status}).` };
  if (spec.parent === undefined) return { exitCode: 1, output: `${spec.key} has no parent Epic: its issues are read from the spec's Epic, so give it one.` };

  const report = checkSpec(spec, await jira.issuesUnder(spec.parent, spec.key));
  const lines = [formatReport(report)];
  if (!report.ok) {
    if (args.close) lines.push("Not closed: the spec stays open while a story or scenario is named by no issue.");
    return { exitCode: 1, output: lines.join("\n") };
  }
  if (args.close) {
    const what = `${count(report.stories.length, "story", "stories")} and ${count(report.scenarios.length, "scenario", "scenarios")}`;
    await jira.closeWithComment(spec.key, `Closed by scripts/spec-stories.ts: ${what}, each named by an issue (${report.children.join(", ") || "none needed"}).`);
    lines.push(`Closed ${spec.key}.`);
  }
  return { exitCode: 0, output: lines.join("\n") };
}

// --- Jira over HTTP ---

interface JiraFields {
  summary?: string;
  description?: unknown;
  labels?: string[];
  status?: { name?: string; statusCategory?: { key?: string } };
  parent?: { key?: string };
}

const toIssue = (key: string, fields: JiraFields): Issue => ({
  key,
  summary: fields.summary ?? "",
  text: adfText(fields.description),
  labels: fields.labels ?? [],
  status: fields.status?.name ?? "",
  statusCategory: fields.status?.statusCategory?.key ?? "",
  parent: fields.parent?.key,
});

const FIELDS = ["summary", "description", "labels", "status", "parent"];

function caller(email: string, token: string, fetchImpl: typeof fetch) {
  const headers = { Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`, Accept: "application/json", "Content-Type": "application/json" };
  return async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const response = await fetchImpl(`${JIRA}/rest/api/3/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    // Status only: Jira's error text is not echoed.
    if (!response.ok) throw new Error(`Jira ${method} ${path.replace(/\?.*$/, "")} answered ${response.status}`);
    return (await response.json()) as unknown;
  };
}

/** Every issue whose parent is the Epic, other than the spec, paged by nextPageToken. */
export async function issuesUnderEpic(email: string, token: string, epic: string, specKey: string, fetchImpl: typeof fetch = fetch): Promise<Issue[]> {
  const call = caller(email, token, fetchImpl);
  const issues: Issue[] = [];
  let nextPageToken: string | undefined;
  for (let page = 0; page < 50; page++) {
    const body = { jql: `project = RP AND parent = ${epic} AND key != ${specKey} ORDER BY key ASC`, fields: FIELDS, maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) };
    const found = (await call("POST", "search/jql", body)) as { issues: { key: string; fields: JiraFields }[]; nextPageToken?: string; isLast?: boolean };
    for (const issue of found.issues) issues.push(toIssue(issue.key, issue.fields));
    nextPageToken = found.nextPageToken;
    if (found.isLast !== false || !nextPageToken) return issues;
  }
  throw new Error(`more than 5000 issues under ${epic}: stopped`);
}

export function specJiraOverHttp(email: string, token: string, fetchImpl: typeof fetch = fetch): SpecJira {
  const call = caller(email, token, fetchImpl);
  const closing = jiraOverHttp(email, token, fetchImpl);
  return {
    async issue(key) {
      const found = (await call("GET", `issue/${key}?fields=${FIELDS.join(",")}`)) as { key: string; fields: JiraFields };
      return toIssue(found.key, found.fields);
    },
    issuesUnder: (epic, specKey) => issuesUnderEpic(email, token, epic, specKey, fetchImpl),
    closeWithComment: (key, comment) => closing.closeWithComment(key, comment),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) throw new Error("Set JIRA_EMAIL and JIRA_API_TOKEN in your environment (see .env.example).");
  const { exitCode, output } = await run(args, specJiraOverHttp(email, token));
  console.log(output);
  process.exit(exitCode);
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
