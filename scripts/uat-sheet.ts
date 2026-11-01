import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { credentialsFrom, type Credentials } from "./jira-upload.ts";

// The UAT test sheet (RP-1163): one self-contained HTML file a tester opens with no server or
// sign-in. It lists a round's Test Cases, records a status, a comment and screenshots for each
// (kept in the browser's IndexedDB), and exports them to Excel with the screenshots embedded.
//
// Usage:
//   node scripts/uat-sheet.ts --round "Round 1" [--jql "<JQL>"] [--uat-url <web url>] [--out <file>]
//   node scripts/uat-sheet.ts --round "Round 1" --issues <issues.json>
//   node scripts/uat-sheet.ts --round "Round 1" --scenarios planning/uat/round-0/test-cases.json
//   add --rounds 0,1 to keep only the cases whose first round is one of those.
// With --issues it reads Jira's search answer (or a list of issues) from a file; with --scenarios the
// round's local test-cases.json (the scenarios the Jira Test Cases were made from); otherwise it
// asks Jira with JIRA_EMAIL and JIRA_API_TOKEN from the environment (never printed, never written).
// The HTML holds Test Case text only: no secrets, no tokens, no customer data.
// A scenario of test-cases.json may declare `"needs": ["mail", "job", "setup", "owner"]` (see NEEDS):
// the sheet shows a "needs the UAT owner" badge for `owner`, a note under a `mail` case that on the UAT
// the mail goes to the real mailbox (its Mailpit wording becomes "the mailbox"), and a badge for the rest.
// tagProblems (run by uat-sheet.test.ts over the real file) fails a case that mentions Mailpit, a job or
// the lane's own machine without the matching need.

const JIRA = "https://rabaedsa.atlassian.net";
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
export const DEFAULT_JQL = 'project = RP AND issuetype = "Test Case" AND labels = uat ORDER BY key';
export const DEFAULT_UAT_URL = "https://rabaed-uat-web.vercel.app";

export interface JiraIssue {
  key: string;
  fields: { summary: string; labels?: string[]; description?: unknown; status?: { name: string } };
}

export interface SheetCase {
  key: string;
  id: string;
  title: string;
  part: string;
  round: string;
  who: string;
  steps: string[];
  expected: string;
  /** What the case needs beyond the demo: see NEEDS. Empty for a case read from Jira. */
  needs: Need[];
  url: string;
}

type Node = { type?: string; text?: string; content?: Node[]; marks?: { type: string }[]; attrs?: { level?: number } };

/** Jira's document format (REST v3) as the markdown its MCP shows, enough for a Test Case's sections. */
function adfToMarkdown(node: Node): string {
  const inline = (n: Node): string =>
    n.type === "text" ? (n.marks?.some((m) => m.type === "strong") ? `**${n.text ?? ""}**` : (n.text ?? "")) : n.type === "hardBreak" ? "\n" : (n.content ?? []).map(inline).join("");
  const block = (n: Node): string => {
    switch (n.type) {
      case "doc":
        return (n.content ?? []).map(block).join("\n\n");
      case "heading":
        return `${"#".repeat(n.attrs?.level ?? 2)} ${inline(n)}`;
      case "orderedList":
        return (n.content ?? []).map((li, i) => `${i + 1}. ${(li.content ?? []).map(block).join(" ")}`).join("\n");
      case "bulletList":
        return (n.content ?? []).map((li) => `* ${(li.content ?? []).map(block).join(" ")}`).join("\n");
      default:
        return inline(n);
    }
  };
  return block(node);
}

const descriptionText = (d: unknown): string => (typeof d === "string" ? d : d && typeof d === "object" ? adfToMarkdown(d as Node) : "");

/** The markdown under `## <name>` up to the next heading. */
function section(md: string, name: string): string {
  const m = new RegExp(`^#{1,3}\\s+${name}\\s*$([\\s\\S]*?)(?=^#{1,3}\\s|$(?![\\s\\S]))`, "m").exec(md);
  return (m?.[1] ?? "").trim();
}

const plain = (s: string) => s.replace(/\*\*|`/g, "").trim();

/** Where a case starts on the UAT: Rabaed Admin for ADM cases, the web app in English otherwise. */
export function startUrl(part: string, uatUrl: string): string {
  const web = uatUrl.replace(/\/+$/, "");
  return part === "ADM" ? web.replace("-web.", "-admin.") : `${web}/en`;
}

/** One Test Case issue as a row of the sheet. */
export function caseFromIssue(issue: JiraIssue, uatUrl: string): SheetCase {
  const md = descriptionText(issue.fields.description);
  const [id = issue.key, ...rest] = issue.fields.summary.trim().split(/\s+/);
  const labels = issue.fields.labels ?? [];
  const part = (/^uat-part-([a-z0-9]+)$/.exec(labels.find((l) => l.startsWith("uat-part-")) ?? "")?.[1] ?? id.split("-")[0] ?? "").toUpperCase();
  const round = /^uat-round-(.+)$/.exec(labels.find((l) => l.startsWith("uat-round-")) ?? "")?.[1] ?? "";
  const who = plain(/\*\*Who:\*\*\s*(.+)/.exec(md)?.[1] ?? "");
  const steps = section(md, "Steps")
    .split("\n")
    .map((l) => /^\s*\d+[.)]\s+(.*)$/.exec(l)?.[1]?.trim())
    .filter((s): s is string => Boolean(s))
    .map(plain);
  // eslint-disable-next-line rabaed/no-avoid-terms -- the Test Case's own heading in Jira, read as written.
  const expected = plain(section(md, "Expected result"));
  return { key: issue.key, id, title: rest.join(" "), part, round, who, steps, expected, needs: [], url: startUrl(part, uatUrl) };
}

/**
 * What a case needs that a tester on the Vercel UAT (ADR 0026) may not have, declared in its `needs` list:
 *   mail   reads or checks an email. On the UAT the mail goes through SendGrid to the real mailbox of the
 *          address, so a demo Member's made-up .test address has no mailbox to read.
 *   job    needs a background or scheduled job (the daily digest, the weekly Step Age report) to be run.
 *   setup  needs a fixture, aged items or a seeded state that its own steps do not create.
 *   owner  needs the UAT owner (the person running the UAT): the lane's machine, pnpm, a port, a lane
 *          engineer, or a mailbox the tester cannot read.
 * The needs come from the scenarios file only (test-cases.json): a Test Case read from Jira has none.
 */
export const NEEDS = ["mail", "job", "setup", "owner"] as const;
export type Need = (typeof NEEDS)[number];

/** A scenario of planning/uat/<round>/test-cases.json, the source the Jira Test Cases were made from. */
export interface ScenarioRow {
  id: string;
  jira: string;
  part: string;
  title: string;
  who?: string;
  steps?: string;
  expected?: string;
  round?: string;
  waits?: string;
  needs?: string[];
}

const unknownNeeds = (needs: readonly string[] = []) => needs.filter((n) => !(NEEDS as readonly string[]).includes(n));

/** A mail case as the Vercel UAT shows it: the mail goes to the real mailbox, so the tester reads "the mailbox", not Mailpit. */
export function vercelWording(text: string): string {
  return text
    .replace(/Mailpit(?:\s*\(lane 7\))?/gi, (_m, offset: number) => (/(^|[.!?]\s+)$/.test(text.slice(0, offset)) ? "The mailbox" : "the mailbox"))
    .replace(/\b([Tt]he) the mailbox/g, "$1 mailbox");
}

// What the text of a case implies it needs; a case that mentions one without declaring it is a false Blocked result on the UAT.
const IMPLIED_NEEDS: { need: Need; pattern: RegExp; says: string; inTitle?: false }[] = [
  { need: "mail", pattern: /\bmailpit\b/i, says: "mentions Mailpit" },
  // Any job (run the job, the digest job, pnpm uat:run-job); a Member's "Daily digest" or "Weekly Step Age report" setting is not one.
  { need: "job", pattern: /\bjobs?\b/i, says: "mentions a job" },
  { need: "owner", pattern: /\blane ?7\b|\bpnpm\b|\blane engineer\b|\.env\b|\bdatabase\b|\bports?\b/i, says: "mentions the lane's own machine" },
  // The AGE and FX-x fixtures, a fixture by name, or aged items. A case that builds a fixture names it in its title ("Fixture FX-C2: ..."), so the title is not read.
  { need: "setup", pattern: /\bFX-[A-Z0-9]+\b|\bAGE\b|\b[Ff]ixture\b|\b[Aa]ged items?\b|\b[Aa]ge (?:the|two|an?|\d+) items?\b/, says: "needs a fixture or aged items", inTitle: false },
];

/** The rows of a test-cases.json whose needs do not match their text: one message each. */
export function tagProblems(rows: (Pick<ScenarioRow, "id"> & Partial<ScenarioRow>)[]): string[] {
  const problems: string[] = [];
  for (const r of rows) {
    const unknown = unknownNeeds(r.needs);
    if (unknown.length) problems.push(`${r.id} declares an unknown need: ${unknown.join(", ")}`);
    const body = [r.who, r.steps, r.expected].join("\n");
    for (const { need, pattern, says, inTitle } of IMPLIED_NEEDS) {
      if (pattern.test(inTitle === false ? body : `${r.title ?? ""}\n${body}`) && !r.needs?.includes(need)) problems.push(`${r.id} ${says}: add ${need} to its needs`);
    }
  }
  return problems;
}

// The round a case first runs, as its Jira label uat-round-N says (planning/uat/strategy.md 10.1):
// what it waits for decides it, and a case waiting for nothing runs in Round 0.
const ROUND_BY_EPIC: [RegExp, string][] = [
  [/RP-589\b/, "5"],
  [/RP-27\b/, "4"],
  [/RP-28\b/, "3"],
  [/RP-23\b/, "2"],
  [/RP-588\b/, "1"],
];
export const roundFromWaits = (waits = ""): string => (/^\s*now\b/i.test(waits) || !waits.trim() ? "0" : (ROUND_BY_EPIC.find(([re]) => re.test(waits))?.[1] ?? ""));

/** The round's local test-cases.json as rows of the sheet; "1) a 2) b" steps split into a list. */
export function casesFromScenarios(text: string, uatUrl: string): SheetCase[] {
  return (JSON.parse(text) as ScenarioRow[]).map((p) => {
    const unknown = unknownNeeds(p.needs);
    if (unknown.length) throw new Error(`${p.id} declares an unknown need: ${unknown.join(", ")}`);
    const needs = (p.needs ?? []) as Need[];
    const words = needs.includes("mail") ? vercelWording : (s: string) => s;
    return {
      key: p.jira,
      id: p.id,
      title: words(p.title),
      part: p.part,
      round: p.round ?? roundFromWaits(p.waits),
      who: plain(p.who ?? ""),
      steps: numberedSteps(p.steps ?? "").map(words),
      expected: words(plain(p.expected ?? "")),
      needs,
      url: startUrl(p.part, uatUrl),
    };
  });
}

/** "1) a 2) b" as ["a", "b"]: only the numbers in order split it, so "port 4750) on" stays inside its step. */
export function numberedSteps(text: string): string[] {
  const steps: string[] = [];
  let rest = text.trim();
  for (let n = 1; ; n++) {
    const here = new RegExp(`^${n}\\)\\s+`).exec(rest);
    if (!here) break;
    rest = rest.slice(here[0].length);
    const next = new RegExp(`(?:^|\\s)${n + 1}\\)\\s+`).exec(rest);
    steps.push(plain(next ? rest.slice(0, next.index) : rest));
    if (!next) return steps.filter(Boolean);
    rest = rest.slice(next.index).trim();
  }
  return rest ? [...steps, plain(rest)].filter(Boolean) : steps.filter(Boolean);
}

function findFflate(): string {
  const store = join(root, "node_modules", ".pnpm");
  const dir = readdirSync(store)
    .filter((d) => d.startsWith("fflate@"))
    .sort()
    .pop();
  if (!dir) throw new Error("fflate is not in node_modules/.pnpm: run pnpm install");
  return readFileSync(join(store, dir, "node_modules", "fflate", "umd", "index.js"), "utf8");
}

/** JSON safe inside a <script>: no "</" can close it. */
const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c").replace(new RegExp("[\\u2028\\u2029]", "g"), (c) => `\\u${c.charCodeAt(0).toString(16)}`);

/**
 * The order the sheet lists cases in: the scenarios file's own order is the strategy's, the order to run them in
 * (RP-1201), so it is kept; cases read from Jira have no such order and are sorted by ID, numbers as numbers.
 */
export function orderCases(cases: SheetCase[], keepOrder: boolean): SheetCase[] {
  return keepOrder ? [...cases] : [...cases].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
}

/** The sheet's HTML: the template with the cases, the UAT address its How to start names, fflate and the Excel writer inlined. */
export function renderSheet({ round, cases, built, uatUrl = DEFAULT_UAT_URL }: { round: string; cases: SheetCase[]; built: string; uatUrl?: string }): string {
  const template = readFileSync(join(here, "uat-sheet", "template.html"), "utf8");
  const writer = readFileSync(join(here, "uat-sheet", "xlsx.mjs"), "utf8").replace(/^export /gm, "");
  return template
    .replace("/*__FFLATE__*/", () => findFflate())
    .replace("/*__XLSX__*/", () => writer)
    .replace("/*__DATA__*/null", () => scriptJson({ round, built, uatUrl: uatUrl.replace(/\/+$/, ""), cases }))
    .replaceAll("__ROUND__", round.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!));
}

/** Every issue the JQL finds, page by page (Jira's enhanced search). */
export async function searchIssues(jql: string, credentials: Credentials, fetchImpl: typeof fetch = fetch): Promise<JiraIssue[]> {
  const headers = { Authorization: `Basic ${Buffer.from(`${credentials.email}:${credentials.token}`).toString("base64")}`, Accept: "application/json", "Content-Type": "application/json" };
  const issues: JiraIssue[] = [];
  let nextPageToken: string | undefined;
  do {
    const body = { jql, fields: ["summary", "labels", "description", "status"], maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) };
    const response = await fetchImpl(`${JIRA}/rest/api/3/search/jql`, { method: "POST", headers, body: JSON.stringify(body) });
    // Status only: Jira's error text is not echoed.
    if (!response.ok) throw new Error(`Jira search answered ${response.status}`);
    const page = (await response.json()) as { issues: JiraIssue[]; nextPageToken?: string; isLast?: boolean };
    issues.push(...page.issues);
    nextPageToken = page.isLast === false || (page.nextPageToken && page.isLast !== true) ? page.nextPageToken : undefined;
  } while (nextPageToken);
  return issues;
}

/** Issues from a saved file: Jira's search answer, the MCP's `{ issues: { nodes } }`, or a plain list. */
export function issuesFromFile(text: string): JiraIssue[] {
  const data = JSON.parse(text) as unknown;
  if (Array.isArray(data)) return data as JiraIssue[];
  const issues = (data as { issues?: unknown }).issues;
  if (Array.isArray(issues)) return issues as JiraIssue[];
  if (issues && typeof issues === "object" && Array.isArray((issues as { nodes?: unknown }).nodes)) return (issues as { nodes: JiraIssue[] }).nodes;
  throw new Error("The issues file holds no issues: expected a list, { issues: [...] } or { issues: { nodes: [...] } }.");
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const round = arg(argv, "--round");
  if (!round) throw new Error('usage: node scripts/uat-sheet.ts --round "Round 1" [--jql <JQL> | --issues <file> | --scenarios <test-cases.json>] [--rounds 0,1] [--uat-url <url>] [--out <file>]');
  const uatUrl = arg(argv, "--uat-url") ?? DEFAULT_UAT_URL;
  const file = arg(argv, "--issues");
  try {
    process.loadEnvFile(join(root, ".env"));
  } catch {
    // No .env: the environment alone.
  }
  const scenarios = arg(argv, "--scenarios");
  const unsorted = scenarios
    ? casesFromScenarios(readFileSync(scenarios, "utf8"), uatUrl)
    : (file ? issuesFromFile(readFileSync(file, "utf8")) : await searchIssues(arg(argv, "--jql") ?? DEFAULT_JQL, credentialsFrom(process.env))).map((i) => caseFromIssue(i, uatUrl));
  const only = arg(argv, "--rounds")?.split(",").map((r) => r.trim());
  const cases = orderCases(
    unsorted.filter((c) => !only || only.includes(c.round)),
    Boolean(scenarios),
  );
  const out = arg(argv, "--out") ?? join(root, "planning", "uat", "sheet", `${slug(round)}.html`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, renderSheet({ round, cases, built: new Date().toISOString().slice(0, 10), uatUrl }));
  console.log(`Wrote ${out}: ${cases.length} Test Cases.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
