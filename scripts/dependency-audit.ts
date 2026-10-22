import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Reports `pnpm audit --prod --json` in a CI job summary (RP-1023). Run by
// .github/workflows/dependency-audit.yml on pull requests that change the lockfile or
// a package.json, and nightly on main. RP-635 checked a new library's advisories by
// hand, and the audit then showed 7 findings, 2 of them high, that no check reported.
//
// Reporting only for now: findings at the level or above become warnings and a table,
// and the job passes. It fails only when the audit itself could not run (a registry
// outage must not read as a clean audit). Failing on findings waits for an allow-list.
//
// Usage: node scripts/dependency-audit.ts <audit.json> [--level high]
// Writes the summary to $GITHUB_STEP_SUMMARY (stdout without it) and the workflow
// commands to stdout. The advisory text comes from the registry: every field is
// escaped for the Markdown table and for the workflow commands.

const SEVERITIES = ["critical", "high", "moderate", "low", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];
const isSeverity = (value: unknown): value is Severity => SEVERITIES.includes(value as Severity);

export interface Advisory {
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
  return { severity, module: stringOrEmpty(entry.module_name), title: stringOrEmpty(entry.title), patched: stringOrEmpty(entry.patched_versions), url: stringOrEmpty(entry.url), paths: findingPaths(entry) };
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

/** The advisories at `level` or above, and the ones below it. */
function splitAtLevel(audit: Audit, level: Severity): { atLevel: Advisory[]; below: Advisory[] } {
  const atLevel = audit.advisories.filter((a) => rank(a.severity) <= rank(level));
  const below = audit.advisories.filter((a) => rank(a.severity) > rank(level));
  return { atLevel, below };
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

const table = (advisories: Advisory[]) => [
  "| Severity | Package | Advisory | Patched | Paths |",
  "| --- | --- | --- | --- | --- |",
  ...advisories.map((a) => `| ${a.severity} | ${tableCell(a.module)} | ${advisoryLink(a)} | ${tableCell(a.patched)} | ${a.paths.map(tableCell).join("<br>")} |`),
];

/** The job summary: counts, a table of the findings at the level or above, the rest in a closed section. */
export function summary(audit: Audit, level: Severity): string {
  const { atLevel, below } = splitAtLevel(audit, level);
  const counts = SEVERITIES.filter((s) => audit.counts[s]).map((s) => `${audit.counts[s]} ${s}`);
  const lines = [
    atLevel.length > 0 ? `## Package audit: ${atLevel.length} at ${level} or above` : `## Package audit: nothing at ${level} or above`,
    "",
    `\`pnpm audit --prod\`: ${counts.length > 0 ? counts.join(", ") : "no findings"} in ${audit.packages} production packages.`,
    "",
  ];
  if (atLevel.length > 0) lines.push(...table(atLevel), "");
  if (below.length > 0) lines.push("<details>", `<summary>${below.length} below ${level}</summary>`, "", ...table(below), "", "</details>", "");
  lines.push("Reporting only (RP-1023): this job does not fail on findings yet. Fix one by moving the package, or the package that brings it in, to a patched version in a dependencies-only PR.");
  return lines.join("\n");
}

/** Workflow-command escaping: data for the message, and also `:` and `,` for a property. */
const commandData = (value: string) => value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
const commandProperty = (value: string) => commandData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");

/** One `::warning` command per advisory at the level or above, shown on the run and the pull request's checks. */
export function warnings(audit: Audit, level: Severity): string[] {
  return splitAtLevel(audit, level).atLevel.map((a) => `::warning title=${commandProperty(`pnpm audit: ${a.severity} in ${a.module}`)}::${commandData(`${a.title}. Patched: ${a.patched}. Path: ${a.paths.join("; ")}. ${a.url}`)}`);
}

/** The summary, the workflow commands and the exit code for one audit's output. */
export function report(output: string, level: Severity): { summary: string; lines: string[]; exitCode: number } {
  let audit: Audit;
  try {
    audit = parseAudit(output);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { summary: ["## Package audit could not run", "", tableCell(reason), "", "Run the workflow again; this is not a clean audit."].join("\n"), lines: [`::error title=pnpm audit::${commandData(reason)}`], exitCode: 1 };
  }
  return { summary: summary(audit, level), lines: warnings(audit, level), exitCode: 0 };
}

function main(argv: string[]): number {
  const [file, flag, value] = argv;
  if (!file || (flag !== undefined && (flag !== "--level" || !isSeverity(value)))) {
    // eslint-disable-next-line rabaed/no-avoid-terms -- the script's file name: npm's dependencies, not a Work Item relationship
    console.error(`Usage: node scripts/dependency-audit.ts <audit.json> [--level ${SEVERITIES.join("|")}]`);
    return 2;
  }
  const result = report(readFileSync(file, "utf8"), isSeverity(value) ? value : "high");
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) appendFileSync(summaryFile, `${result.summary}\n`);
  else console.log(result.summary);
  for (const line of result.lines) console.log(line);
  return result.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) process.exitCode = main(process.argv.slice(2));
