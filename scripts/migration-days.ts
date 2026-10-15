import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { combineReservations, parseReservations, reservationsFile, reservedIssues } from "./check-migrations-days.ts";

// `pnpm migration-days --spec RP-nnn` (RP-587, from the spec RP-462 retro): lists
// the spec's tickets that have no day in planning/migration-days.md, before
// implementers start. RP-453 took 20270320 from main's latest migration, and
// the first warning came from `pnpm check:migrations` on the merged integration
// branch, after the migration was written. Only the planning session edits
// that file, so ask it for the days this names.
//
// The tickets come from the spec's ticket table in Jira (JIRA_EMAIL and
// JIRA_API_TOKEN, as scripts/jira-close.ts), or from `--tickets RP-a,RP-b`
// offline. The reservations are origin/main's, plus the branch's for the days
// main doesn't reserve, as `check:migrations` reads them.
// The Jira and file calls sit behind MigrationDaysSeam so the tests touch neither.

const JIRA = "https://rabaedsa.atlassian.net";

export interface MigrationDaysSeam {
  /** True when JIRA_EMAIL and JIRA_API_TOKEN are set. */
  credentials(): boolean;
  /** The spec issue's description, as Jira's document format (ADF). */
  specDescription(key: string): Promise<unknown>;
  /** The reservations file's text on origin/main, then in this worktree ("" when missing). */
  reservations(): [onMain: string, onBranch: string];
}

export interface MigrationDaysResult {
  ok: boolean;
  lines: string[];
}

// eslint-disable-next-line rabaed/no-avoid-terms -- the flag RP-587 names: Jira tickets, not Rabaed items
const issuesFlag = "--tickets";
// eslint-disable-next-line rabaed/no-avoid-terms -- the command's own name: database migrations, not a data import
const usage = `Usage: pnpm migration-days --spec RP-nnn [${issuesFlag} RP-a,RP-b]   (${issuesFlag}: the spec's issues, offline, without Jira)`;
const fail = (...lines: string[]): MigrationDaysResult => ({ ok: false, lines });
const isKey = (value: string) => /^RP-\d+$/.test(value);

interface AdfNode {
  type?: string;
  text?: string;
  content?: AdfNode[];
}

const nodes = (node: unknown): AdfNode[] => (node !== null && typeof node === "object" ? [node as AdfNode] : []);
const textOf = (node: AdfNode): string => node.text ?? (node.content ?? []).map(textOf).join("");
const descendants = (node: AdfNode, type: string): AdfNode[] => (node.type === type ? [node] : (node.content ?? []).flatMap((child) => descendants(child, type)));

/** The issues of a spec's table: each table row's first cell that holds one issue key alone ("RP-593, RP-591" is a Blocked by cell). */
export function specIssues(description: unknown): string[] {
  return nodes(description)
    .flatMap((doc) => descendants(doc, "tableRow"))
    .flatMap((row) => (row.content ?? []).map((cell) => textOf(cell).trim()).filter(isKey).slice(0, 1));
}

/** The values after a flag, up to the next flag; undefined when the flag is absent. */
function flagValues(args: string[], name: string): string[] | undefined {
  const at = args.indexOf(name);
  if (at === -1) return undefined;
  const end = args.findIndex((arg, index) => index > at && arg.startsWith("--"));
  return args.slice(at + 1, end === -1 ? undefined : end);
}

export async function migrationDays(args: string[], seam: MigrationDaysSeam): Promise<MigrationDaysResult> {
  const specValues = flagValues(args, "--spec");
  const spec = specValues?.[0];
  // PowerShell passes `RP-a,RP-b` as two arguments: take commas, spaces and arguments alike.
  const given = flagValues(args, issuesFlag)?.flatMap((value) => value.split(/[,\s]+/).filter(Boolean));
  const badSpec = specValues !== undefined && (specValues.length !== 1 || !isKey(spec ?? ""));
  const badIssues = given !== undefined && (given.length === 0 || !given.every(isKey));
  if ((specValues === undefined && given === undefined) || badSpec || badIssues) return fail(usage);

  let keys = given;
  if (keys === undefined) {
    if (!seam.credentials()) return fail(`JIRA_EMAIL and JIRA_API_TOKEN are not set, so ${spec}'s issue table can't be read. Pass the spec's issues with ${issuesFlag} RP-a,RP-b.`, usage);
    keys = specIssues(await seam.specDescription(spec as string));
    if (keys.length === 0) return fail(`${spec}'s description has no issue table (a table row with an issue key in a cell of its own). Pass the issues with ${issuesFlag} RP-a,RP-b.`);
  }

  const [onMain, onBranch] = seam.reservations();
  const reserved = reservedIssues(combineReservations(parseReservations(onMain), parseReservations(onBranch)));
  const missing = keys.filter((key) => !reserved.has(key));
  const of = spec === undefined ? "" : ` of ${spec}`;
  if (missing.length === 0) return { ok: true, lines: [`Every issue${of} has a day in ${reservationsFile}: ${keys.join(", ")}.`] };
  return fail(
    `No day in ${reservationsFile} is reserved for ${missing.join(", ")}${of}.`,
    "If any of them may change the database schema, ask the planning session to reserve days before the implementers start.",
  );
}

/** The real Jira and file calls, in the repository at `repo`. */
export function realSeam(repo: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): MigrationDaysSeam {
  const git = (...args: string[]) => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  const local = join(repo, reservationsFile);
  return {
    credentials: () => Boolean(env.JIRA_EMAIL && env.JIRA_API_TOKEN),
    async specDescription(key) {
      const headers = { Authorization: `Basic ${Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64")}`, Accept: "application/json" };
      const response = await fetch(`${JIRA}/rest/api/3/issue/${key}?fields=description`, { headers });
      // Status only: Jira's error text is not echoed into the log.
      if (!response.ok) throw new Error(`Jira GET issue/${key} answered ${response.status}`);
      return ((await response.json()) as { fields: { description: unknown } }).fields.description;
    },
    reservations: () => {
      // Offline, the fetch fails and the last-fetched origin/main counts.
      git("fetch", "origin", "main");
      return [git("show", `origin/main:${reservationsFile}`).stdout ?? "", existsSync(local) ? readFileSync(local, "utf8") : ""];
    },
  };
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  try {
    const result = await migrationDays(process.argv.slice(2), realSeam());
    for (const line of result.lines) (result.ok ? console.log : console.error)(line);
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
