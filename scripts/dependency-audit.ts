import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Reports `pnpm audit --prod --json` in a CI job summary (RP-1023). Run by
// .github/workflows/dependency-audit.yml on pull requests that change the lockfile or
// a package.json, and nightly on main. RP-635 checked a new library's advisories by
// hand, and the audit then showed 7 findings, 2 of them high, that no check reported.
//
// Fails on new findings (RP-1032): an advisory at the level or above exits 1, with an
// error line and a table, unless `.audit-allowlist.json` at the repo root lists its id
// with a reason and a review date. Listed advisories get a table of their own; an entry
// past its review date, or one the audit no longer finds, is named and warned about.
// It also fails when the audit could not run (a registry outage must not read as a
// clean audit) or the allow-list is malformed.
//
// Usage: node scripts/dependency-audit.ts <audit.json> [--level high]
// Writes the summary to $GITHUB_STEP_SUMMARY (stdout without it) and the workflow
// commands to stdout. The advisory text comes from the registry: every field is
// escaped for the Markdown table and for the workflow commands.

const SEVERITIES = ["critical", "high", "moderate", "low", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];
const isSeverity = (value: unknown): value is Severity => SEVERITIES.includes(value as Severity);

export interface Advisory {
  /** GitHub's advisory id (GHSA-…), or pnpm's own number when there is none: the allow-list's key. */
  id: string;
  severity: Severity;
  module: string;
  title: string;
  patched: string;
  url: string;
  /** Package paths from a workspace folder, e.g. "apps/web › next". */
  paths: string[];
}

export interface Audit {
  advisories: Advisory[];
  counts: Partial<Record<Severity, number>>;
  /** The production packages pnpm audited. */
  packages: number;
}

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const stringOrEmpty = (value: unknown) => (typeof value === "string" ? value : "");
const rank = (severity: Severity) => SEVERITIES.indexOf(severity);

/** pnpm names a workspace folder by its path with "__" for "/" (apps__web>next>postcss). */
const readPath = (path: string) =>
  path
    .split(">")
    .map((part, index) => (index === 0 ? part.replaceAll("__", "/") : part))
    .join(" › ");

/** Every distinct path one advisory was found on. */
function findingPaths(entry: Obj): string[] {
  const findings = Array.isArray(entry.findings) ? entry.findings.filter(isObj) : [];
  const paths = findings.flatMap((finding) => (Array.isArray(finding.paths) ? finding.paths.map(stringOrEmpty) : []));
  return [...new Set(paths)].map(readPath);
}

function readAdvisory(entry: Obj): Advisory {
  // An unknown severity counts as critical, so a new pnpm level is never hidden below the line.
  const severity = isSeverity(entry.severity) ? entry.severity : "critical";
  const id = stringOrEmpty(entry.github_advisory_id) || (typeof entry.id === "number" || typeof entry.id === "string" ? String(entry.id) : "");
  return { id, severity, module: stringOrEmpty(entry.module_name), title: stringOrEmpty(entry.title), patched: stringOrEmpty(entry.patched_versions), url: stringOrEmpty(entry.url), paths: findingPaths(entry) };
}

function readJson(output: string): Obj {
  try {
    const json: unknown = JSON.parse(output);
    if (isObj(json)) return json;
  } catch {
    // Not JSON at all: same answer as JSON that is not an object.
  }
  throw new Error("pnpm audit printed no JSON.");
}

/** The advisories in `pnpm audit --json` output, most severe first; throws when the audit did not run. */
export function parseAudit(output: string): Audit {
  const json = readJson(output);
  if (isObj(json.error)) throw new Error(`pnpm audit failed: ${stringOrEmpty(json.error.code)} ${stringOrEmpty(json.error.message)}`.trim());
  if (!isObj(json.advisories) || !isObj(json.metadata)) throw new Error("pnpm audit printed no advisories.");

  const advisories = Object.values(json.advisories)
    .filter(isObj)
    .map(readAdvisory)
    .sort((a, b) => rank(a.severity) - rank(b.severity) || a.module.localeCompare(b.module) || a.title.localeCompare(b.title));

  const vulnerabilities = isObj(json.metadata.vulnerabilities) ? json.metadata.vulnerabilities : {};
  const counts: Audit["counts"] = {};
  for (const severity of SEVERITIES) {
    const count = vulnerabilities[severity];
    if (typeof count === "number" && count > 0) counts[severity] = count;
  }
  const packages = typeof json.metadata.dependencies === "number" ? json.metadata.dependencies : 0;
  return { advisories, counts, packages };
}

/** An advisory that cannot be fixed yet: why, and the date to look at it again. */
export interface AllowEntry {
  id: string;
  reason: string;
  /** YYYY-MM-DD. */
  review: string;
}

const ALLOWLIST = ".audit-allowlist.json";

/** A real calendar date written YYYY-MM-DD (not 2026-02-30). */
function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}
const nonBlank = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/** The allow-list file's entries; undefined (no file) is an empty list. Throws, naming the entry, on anything malformed. */
export function parseAllowlist(text: string | undefined): AllowEntry[] {
  if (text === undefined) return [];
  let json: unknown;
  try {
    // A byte-order mark, as PowerShell 5.1 and some Windows editors save UTF-8, is not part of the JSON.
    json = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error(`${ALLOWLIST} is not JSON.`);
  }
  if (!isObj(json) || !Array.isArray(json.advisories)) throw new Error(`${ALLOWLIST} needs an "advisories" list.`);
  const seen = new Set<string>();
  return json.advisories.map((entry: unknown, index) => {
    // An advisory id's own characters (GHSA-xxxx-xxxx-xxxx, or pnpm's number): the summary prints it in a code span.
    const id = isObj(entry) && typeof entry.id === "string" && /^[A-Za-z0-9-]+$/.test(entry.id) ? entry.id : undefined;
    if (!isObj(entry) || !id || !nonBlank(entry.reason) || !isDate(entry.review)) {
      throw new Error(`${ALLOWLIST} entry ${index + 1}${id ? ` (${id})` : ""} needs an "id", a "reason" and a "review" date (YYYY-MM-DD).`);
    }
    if (seen.has(id)) throw new Error(`${ALLOWLIST} lists ${id} twice.`);
    seen.add(id);
    return { id, reason: entry.reason, review: entry.review };
  });
}

/** The allow-list's entries and the run's UTC date (YYYY-MM-DD), against which review dates are read. */
export interface Allowance {
  entries: AllowEntry[];
  today: string;
}

const noAllowance: Allowance = { entries: [], today: "" };

interface Classified {
  /** At the level or above, and not allow-listed: these fail the job. */
  failing: Advisory[];
  allowed: { advisory: Advisory; entry: AllowEntry }[];
  /** Below the level, and not allow-listed. */
  below: Advisory[];
  /** Entries whose review date has passed. */
  pastReview: AllowEntry[];
  /** Entries the audit no longer finds. */
  notFound: AllowEntry[];
}

const atLevel = (advisory: Advisory, level: Severity) => rank(advisory.severity) <= rank(level);

function classify(audit: Audit, level: Severity, { entries, today }: Allowance): Classified {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const classified: Classified = { failing: [], allowed: [], below: [], pastReview: [], notFound: [] };
  for (const advisory of audit.advisories) {
    const entry = byId.get(advisory.id);
    if (entry) classified.allowed.push({ advisory, entry });
    else if (atLevel(advisory, level)) classified.failing.push(advisory);
    else classified.below.push(advisory);
  }
  const found = new Set(audit.advisories.map((a) => a.id));
  classified.notFound = entries.filter((entry) => !found.has(entry.id));
  classified.pastReview = entries.filter((entry) => found.has(entry.id) && entry.review < today);
  return classified;
}

/** Registry text in a Markdown table cell: one line, no column break, no link or HTML syntax. */
const tableCell = (value: string) =>
  value
    .replace(/\s+/g, " ")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replace(/[|[\]`]/g, (char) => `\\${char}`)
    .trim();

/** An advisory's title, linked when its URL is https; the URL cannot close the link early. */
function advisoryLink(advisory: Advisory): string {
  if (!advisory.url.startsWith("https://")) return tableCell(advisory.title);
  const url = encodeURI(advisory.url).replaceAll("(", "%28").replaceAll(")", "%29");
  return `[${tableCell(advisory.title)}](${url})`;
}

const pathsCell = (advisory: Advisory) => advisory.paths.map(tableCell).join("<br>");

const table = (advisories: Advisory[]) => [
  "| Severity | Package | Advisory | Patched | Paths |",
  "| --- | --- | --- | --- | --- |",
  ...advisories.map((a) => `| ${a.severity} | ${tableCell(a.module)} | ${advisoryLink(a)} | ${tableCell(a.patched)} | ${pathsCell(a)} |`),
];

/** Paths too: one GitHub advisory can come as two pnpm advisories (two version ranges), and the paths tell the rows apart. */
const allowedTable = (allowed: Classified["allowed"]) => [
  "| Severity | Package | Advisory | Reason | Review by | Paths |",
  "| --- | --- | --- | --- | --- | --- |",
  ...allowed.map(({ advisory: a, entry }) => `| ${a.severity} | ${tableCell(a.module)} | ${advisoryLink(a)} | ${tableCell(entry.reason)} | ${entry.review} | ${pathsCell(a)} |`),
];

/** The job summary: counts, a table of the failing findings, the allow-listed ones, and the rest in a closed section. */
export function summary(audit: Audit, level: Severity, allowance: Allowance = noAllowance): string {
  const { failing, allowed, below, pastReview, notFound } = classify(audit, level, allowance);
  const counts = SEVERITIES.filter((s) => audit.counts[s]).map((s) => `${audit.counts[s]} ${s}`);
  const lines = [
    failing.length > 0
      ? `## Package audit failed: ${failing.length} at ${level} or above, not allow-listed`
      : `## Package audit: nothing at ${level} or above${allowed.some(({ advisory }) => atLevel(advisory, level)) ? " outside the allow-list" : ""}`,
    "",
    `\`pnpm audit --prod\`: ${counts.length > 0 ? counts.join(", ") : "no findings"} in ${audit.packages} production packages.`,
    "",
  ];
  if (failing.length > 0) lines.push(...table(failing), "");
  for (const entry of pastReview) lines.push(`**Review date passed:** \`${entry.id}\` (review by ${entry.review}). Fix it, or give it a new reason and review date.`, "");
  for (const entry of notFound) lines.push(`**No longer found:** \`${entry.id}\`. Remove it from \`${ALLOWLIST}\`.`, "");
  if (allowed.length > 0) lines.push(`### Allow-listed: ${allowed.length}`, "", ...allowedTable(allowed), "");
  if (below.length > 0) lines.push("<details>", `<summary>${below.length} below ${level}</summary>`, "", ...table(below), "", "</details>", "");
  lines.push(
    `The job fails on an advisory at ${level} or above that \`${ALLOWLIST}\` does not list (RP-1032). Fix one by moving the package, or the package that brings it in, to a patched version in a dependencies-only PR. One with no fix yet goes on the allow-list, with a reason and a review date.`,
  );
  return lines.join("\n");
}

/** Workflow-command escaping: data for the message, and also `:` and `,` for a property. */
const commandData = (value: string) => value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
const commandProperty = (value: string) => commandData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
const allowlistWarning = (message: string) => `::warning title=${commandProperty("pnpm audit: allow-list")}::${commandData(message)}`;

/** Workflow commands shown on the run and the pull request's checks: an error per failing advisory, a warning per stale allow-list entry. */
export function workflowCommands(audit: Audit, level: Severity, allowance: Allowance = noAllowance): string[] {
  const { failing, pastReview, notFound } = classify(audit, level, allowance);
  return [
    ...failing.map((a) => `::error title=${commandProperty(`pnpm audit: ${a.severity} in ${a.module}`)}::${commandData(`${a.title}. Patched: ${a.patched}. Path: ${a.paths.join("; ")}. ${a.url}`)}`),
    ...pastReview.map((entry) => allowlistWarning(`${entry.id} was to be reviewed by ${entry.review}. Fix it, or give it a new reason and review date in ${ALLOWLIST}.`)),
    ...notFound.map((entry) => allowlistWarning(`${entry.id} is no longer found. Remove it from ${ALLOWLIST}.`)),
  ];
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const couldNotRun = (reason: string, next: string) => ({
  summary: ["## Package audit could not run", "", tableCell(reason), "", next].join("\n"),
  lines: [`::error title=pnpm audit::${commandData(reason)}`],
  exitCode: 1,
});

/**
 * The summary, the workflow commands and the exit code for one audit's output: 1 when an advisory at
 * `level` or above is not allow-listed, or when the audit or the allow-list could not be read.
 * `allowlist` is the file's text (undefined: no file); `today` is YYYY-MM-DD.
 */
export function report(output: string, level: Severity, { allowlist, today }: { allowlist: string | undefined; today: string }): { summary: string; lines: string[]; exitCode: number } {
  let audit: Audit;
  try {
    audit = parseAudit(output);
  } catch (error) {
    return couldNotRun(message(error), "Run the workflow again; this is not a clean audit.");
  }
  let entries: AllowEntry[];
  try {
    entries = parseAllowlist(allowlist);
  } catch (error) {
    return couldNotRun(message(error), `Fix \`${ALLOWLIST}\`; this is not a clean audit.`);
  }
  const allowance = { entries, today };
  const failing = classify(audit, level, allowance).failing.length > 0;
  return { summary: summary(audit, level, allowance), lines: workflowCommands(audit, level, allowance), exitCode: failing ? 1 : 0 };
}

function main(argv: string[]): number {
  const [file, flag, value] = argv;
  if (!file || (flag !== undefined && (flag !== "--level" || !isSeverity(value)))) {
    // eslint-disable-next-line rabaed/no-avoid-terms -- the script's file name: npm's dependencies, not a Work Item relationship
    console.error(`Usage: node scripts/dependency-audit.ts <audit.json> [--level ${SEVERITIES.join("|")}]`);
    return 2;
  }
  const allowlistFile = resolve(import.meta.dirname, "..", ALLOWLIST);
  const allowlist = existsSync(allowlistFile) ? readFileSync(allowlistFile, "utf8") : undefined;
  const today = new Date().toISOString().slice(0, 10);
  const result = report(readFileSync(file, "utf8"), isSeverity(value) ? value : "high", { allowlist, today });
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) appendFileSync(summaryFile, `${result.summary}\n`);
  else console.log(result.summary);
  for (const line of result.lines) console.log(line);
  return result.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) process.exitCode = main(process.argv.slice(2));
