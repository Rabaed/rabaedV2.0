/* eslint-disable rabaed/no-avoid-terms -- npm's dependencies, GitHub's annotations and its Actions tab, by their own names */
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Reports `pnpm audit --prod --json` in a CI job summary (RP-1023). Run by
// .github/workflows/dependency-audit.yml on pull requests that change the lockfile or
// a package.json, and nightly on main. RP-635 checked a new library's advisories by
// hand, and the audit then showed 7 findings, 2 of them high, that no check reported.
//
// Reporting only for now: findings at the bar become warnings and a table, and the job
// passes. It fails only when the audit itself could not run (a registry outage must not
// read as a clean audit). Making it fail on findings waits for an allow-list (RP-1023).
//
// Usage: node scripts/dependency-audit.ts <audit.json> [--level high]
// Writes the summary to $GITHUB_STEP_SUMMARY (stdout without it) and the workflow
// commands to stdout. The advisory text comes from the registry: it is escaped for
// both the Markdown table and the workflow commands.

const SEVERITIES = ["critical", "high", "moderate", "low", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface Advisory {
  severity: Severity;
  module: string;
  title: string;
  patched: string;
  url: string;
  /** Dependency paths from a workspace folder, e.g. "apps/web › next". */
  paths: string[];
}

export interface Audit {
  advisories: Advisory[];
  counts: Partial<Record<Severity, number>>;
  dependencies: number;
}

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value : "");
const rank = (severity: Severity) => SEVERITIES.indexOf(severity);
const asSeverity = (value: unknown): Severity => (SEVERITIES.includes(value as Severity) ? (value as Severity) : "info");

/** pnpm names a workspace folder by its path with "__" for "/" (apps__web>next). */
const readPath = (path: string) =>
  path
    .split(">")
    .map((part, index) => (index === 0 ? part.replaceAll("__", "/") : part))
    .join(" › ");

/** The advisories in `pnpm audit --json` output, most severe first; throws when the audit did not run. */
export function parseAudit(output: string): Audit {
  let json: unknown;
  try {
    json = JSON.parse(output);
  } catch {
    throw new Error("pnpm audit printed no JSON.");
  }
  if (!isObj(json)) throw new Error("pnpm audit printed no JSON.");
  if (isObj(json.error)) throw new Error(`pnpm audit failed: ${text(json.error.code)} ${text(json.error.message)}`.trim());
  if (!isObj(json.advisories) || !isObj(json.metadata)) throw new Error("pnpm audit printed no advisories.");

  const advisories = Object.values(json.advisories)
    .filter(isObj)
    .map(
      (entry): Advisory => ({
        severity: asSeverity(entry.severity),
        module: text(entry.module_name),
        title: text(entry.title),
        patched: text(entry.patched_versions),
        url: text(entry.url),
        paths: [...new Set((Array.isArray(entry.findings) ? entry.findings : []).filter(isObj).flatMap((finding) => (Array.isArray(finding.paths) ? finding.paths.map(text) : [])))].map(readPath),
      }),
    )
    .sort((a, b) => rank(a.severity) - rank(b.severity) || a.module.localeCompare(b.module) || a.title.localeCompare(b.title));

  const vulnerabilities = isObj(json.metadata.vulnerabilities) ? json.metadata.vulnerabilities : {};
  const counts: Audit["counts"] = {};
  for (const severity of SEVERITIES) {
    const count = vulnerabilities[severity];
    if (typeof count === "number" && count > 0) counts[severity] = count;
  }
  const dependencies = typeof json.metadata.dependencies === "number" ? json.metadata.dependencies : 0;
  return { advisories, counts, dependencies };
}

const atBar = (audit: Audit, level: Severity) => audit.advisories.filter((a) => rank(a.severity) <= rank(level));
const belowBar = (audit: Audit, level: Severity) => audit.advisories.filter((a) => rank(a.severity) > rank(level));

/** Registry text in a Markdown table cell: one line, no column break, no link or HTML syntax. */
const cell = (value: string) =>
  value
    .replace(/\s+/g, " ")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replace(/[|[\]]/g, (char) => `\\${char}`)
    .trim();

const table = (advisories: Advisory[]) => [
  "| Severity | Package | Advisory | Patched | Paths |",
  "| --- | --- | --- | --- | --- |",
  ...advisories.map((a) => `| ${a.severity} | \`${a.module.replaceAll("`", "")}\` | [${cell(a.title)}](${encodeURI(a.url)}) | ${cell(a.patched)} | ${a.paths.map(cell).join("<br>")} |`),
];

/** The job summary: counts, a table of the findings at the bar, the rest in a closed section. */
export function summary(audit: Audit, level: Severity): string {
  const above = atBar(audit, level);
  const below = belowBar(audit, level);
  const counts = SEVERITIES.filter((s) => audit.counts[s]).map((s) => `${audit.counts[s]} ${s}`);
  const lines = [
    above.length > 0 ? `## Dependency audit: ${above.length} at ${level} or above` : `## Dependency audit: nothing at ${level} or above`,
    "",
    `\`pnpm audit --prod\`: ${counts.length > 0 ? counts.join(", ") : "no findings"} in ${audit.dependencies} production dependencies.`,
    "",
  ];
  if (above.length > 0) lines.push(...table(above), "");
  if (below.length > 0) lines.push("<details>", `<summary>${below.length} below ${level}</summary>`, "", ...table(below), "", "</details>", "");
  lines.push("Reporting only (RP-1023): this job does not fail on findings yet. Fix one by moving the package, or the dependency that brings it in, to a patched version in a dependencies-only PR.");
  return lines.join("\n");
}

/** Workflow-command escaping: data for the message, and also `:` and `,` for a property. */
const commandData = (value: string) => value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
const commandProperty = (value: string) => commandData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");

/** One `::warning` per advisory at the bar, shown on the run and the pull request's checks. */
export function annotations(audit: Audit, level: Severity): string[] {
  return atBar(audit, level).map((a) => `::warning title=${commandProperty(`pnpm audit: ${a.severity} in ${a.module}`)}::${commandData(`${a.title}. Patched: ${a.patched}. Path: ${a.paths.join("; ")}. ${a.url}`)}`);
}

/** The summary, the workflow commands and the exit code for one audit's output. */
export function report(output: string, level: Severity): { summary: string; lines: string[]; exitCode: number } {
  let audit: Audit;
  try {
    audit = parseAudit(output);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { summary: ["## Dependency audit could not run", "", reason, "", "Run it again from the Actions tab; this is not a clean audit."].join("\n"), lines: [`::error title=pnpm audit::${commandData(reason)}`], exitCode: 1 };
  }
  return { summary: summary(audit, level), lines: annotations(audit, level), exitCode: 0 };
}

function main(argv: string[]): number {
  const [file, flag, value] = argv;
  if (!file || (flag !== undefined && (flag !== "--level" || !SEVERITIES.includes(value as Severity)))) {
    console.error(`Usage: node scripts/dependency-audit.ts <audit.json> [--level ${SEVERITIES.join("|")}]`);
    return 2;
  }
  const result = report(readFileSync(file, "utf8"), (value as Severity | undefined) ?? "high");
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) appendFileSync(summaryFile, `${result.summary}\n`);
  else console.log(result.summary);
  for (const line of result.lines) console.log(line);
  return result.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) process.exitCode = main(process.argv.slice(2));
