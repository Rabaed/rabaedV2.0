import { resolve } from "node:path";
import { combineReservations, parseReservations, reservationsFile, reservedIssues } from "./check-migrations-days.ts";
import { laneOf } from "./lanes.ts";
import { fetchOrigin, freeDay, type FreeDaySeam, nextDay, readRepoFile, realFreeDaySeam, repoGit } from "./migration-free-days.ts";

// `pnpm migration:days --spec RP-nnn` (RP-587, from the spec RP-462 retro): lists
// the spec's issues that have no day in planning/migration-days.md, before
// implementers start. RP-453 took 20270320 from main's latest migration, and
// the first warning came from `pnpm check:migrations` on the merged integration
// branch, after the migration was written. Only the planning session edits
// that file, so ask it for the days this names.
//
// The issues come from the "Ticket" column of the spec's table in Jira
// (JIRA_EMAIL and JIRA_API_TOKEN, as scripts/jira-close.ts), or from
// `--tickets RP-a,RP-b` offline. The reservations are origin/main's, plus
// this worktree's for the days main doesn't reserve, as `check:migrations` reads them.
//
// `pnpm migration:days --next <n>` (RP-966, from the RP-616 retro): after `git
// fetch origin`, prints the next n free days (at most 60), the latest day taken
// and what took it, and the rows to paste into planning/migration-days.md, with
// this worktree's lane. It writes nothing. The scan is migration:new's freeDay
// (scripts/migration-free-days.ts). `pnpm migration-days` is the older name.
//
// The git and Jira calls sit behind MigrationDaysSeam so the tests touch neither.

const JIRA = "https://rabaedsa.atlassian.net";
const maxNext = 60;

export interface MigrationDaysSeam extends FreeDaySeam {
  /** `git fetch origin --prune`; false when it fails. */
  fetch(): boolean;
  /** This worktree's lane, from its .env; "" when it has none. */
  lane(): string;
  /** True when JIRA_EMAIL and JIRA_API_TOKEN are set. */
  credentials(): boolean;
  /** The spec issue's description, as Jira's document format (ADF). */
  specDescription(key: string): Promise<unknown>;
}

export interface MigrationDaysResult {
  ok: boolean;
  lines: string[];
}

// eslint-disable-next-line rabaed/no-avoid-terms -- the flag RP-587 names: Jira tickets, not Rabaed items
const issuesFlag = "--tickets";
// eslint-disable-next-line rabaed/no-avoid-terms -- the spec tables' column header: Jira tickets, not Rabaed items
const issuesColumn = "Ticket";
const usage = [
  `Usage: pnpm migration:days --spec RP-nnn [${issuesFlag} RP-a,RP-b]   (${issuesFlag}: the spec's issues, offline, without Jira)`,
  // eslint-disable-next-line rabaed/no-avoid-terms -- database migrations, not a data import
  "       pnpm migration:days --next <n>   (the next n free migration days; writes nothing)",
].join("\n");
const fail = (...lines: string[]): MigrationDaysResult => ({ ok: false, lines });
const isKey = (value: string) => /^RP-\d+$/.test(value);

interface AdfNode {
  type?: string;
  text?: string;
  attrs?: { url?: string };
  content?: AdfNode[];
}

/** A node's text; a smart link (inlineCard) reads as the issue key its URL ends in; a cell's paragraphs are joined by spaces. */
function textOf(node: AdfNode): string {
  if (node.type === "inlineCard") return /\/browse\/(RP-\d+)\b/.exec(node.attrs?.url ?? "")?.[1] ?? node.attrs?.url ?? "";
  if (node.text !== undefined) return node.text;
  return (node.content ?? []).map(textOf).join(node.type === "tableCell" || node.type === "tableHeader" ? " " : "");
}

const descendants = (node: AdfNode, type: string): AdfNode[] => (node.type === type ? [node] : (node.content ?? []).flatMap((child) => descendants(child, type)));

/** What a spec's issue table gives: its issues, and the cells of that column that aren't one key. */
export interface SpecIssues {
  /** False when the description has no table with a "Ticket" header cell. */
  found: boolean;
  issues: string[];
  unreadable: string[];
}

/**
 * The issues of a spec's table: the column headed "Ticket" of the first table
 * that has one, one key per row. A cell that isn't one key alone is
 * unreadable, so a row is never silently left out of the check.
 */
export function specIssues(description: unknown): SpecIssues {
  const doc = description !== null && typeof description === "object" ? (description as AdfNode) : {};
  for (const table of descendants(doc, "table")) {
    const [header, ...rows] = descendants(table, "tableRow").map((row) => (row.content ?? []).map((cell) => textOf(cell).trim()));
    const column = (header ?? []).findIndex((cell) => cell.toLowerCase() === issuesColumn.toLowerCase());
    if (column === -1) continue;
    const cells = rows.map((row) => row[column] ?? "");
    return { found: true, issues: cells.filter(isKey), unreadable: cells.filter((cell) => !isKey(cell)) };
  }
  return { found: false, issues: [], unreadable: [] };
}

/** The values after a flag, up to the next flag; undefined when the flag is absent. */
function flagValues(args: string[], name: string): string[] | undefined {
  const at = args.indexOf(name);
  if (at === -1) return undefined;
  const end = args.findIndex((arg, index) => index > at && arg.startsWith("--"));
  return args.slice(at + 1, end === -1 ? undefined : end);
}

/** The spec's issues (or the given ones) with no reserved day: ok when there are none. */
export async function unreservedSpecIssues(args: string[], seam: MigrationDaysSeam): Promise<MigrationDaysResult> {
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
    const table = specIssues(await seam.specDescription(spec as string));
    if (!table.found) return fail(`${spec}'s description has no issue table (a table with a "${issuesColumn}" column). Pass the issues with ${issuesFlag} RP-a,RP-b.`);
    if (table.unreadable.length > 0) {
      return fail(`${spec}'s "${issuesColumn}" column has cells that aren't one issue key: ${table.unreadable.map((cell) => `"${cell}"`).join(", ")}. Fix the table, or pass the issues with ${issuesFlag} RP-a,RP-b.`);
    }
    keys = table.issues;
  }

  const warnings = seam.fetch() ? [] : ["Warning: git fetch origin failed; checked against the last-fetched origin/main."];
  const [onMain, onBranch] = seam.reservations();
  const reserved = reservedIssues(combineReservations(parseReservations(onMain), parseReservations(onBranch)));
  const missing = keys.filter((key) => !reserved.has(key));
  const ofSpec = spec === undefined ? "" : ` of ${spec}`;
  if (missing.length === 0) return { ok: true, lines: [...warnings, `Every issue${ofSpec} has a day in ${reservationsFile}: ${keys.join(", ")}.`] };
  return fail(
    ...warnings,
    `No day in ${reservationsFile} is reserved for ${missing.join(", ")}${ofSpec}.`,
    "If any of them may change the database schema, ask the planning session to reserve days before the implementers start.",
  );
}

/** The next n free days after everything freeDay counts, and the rows that reserve them. */
export function nextFreeDays(args: string[], seam: MigrationDaysSeam): MigrationDaysResult {
  const values = flagValues(args, "--next") ?? [];
  const count = values.length === 1 && /^[1-9]\d*$/.test(values[0] ?? "") ? Number(values[0]) : 0;
  if (count === 0 || args.length !== 2) return fail(usage);
  if (count > maxNext) return fail(`--next takes at most ${maxNext} days (asked for ${count}). Reserve the first block, then run it again for more.`);
  if (!seam.fetch()) return fail("git fetch origin failed; the free days need today's main and branches. Get online and run `pnpm migration:days --next` again.");

  const { first, latest, warnings } = freeDay(seam);
  const free = [first];
  while (free.length < count) free.push(nextDay(free.at(-1) as string));
  const lane = seam.lane();
  return {
    ok: true,
    lines: [
      ...warnings,
      // eslint-disable-next-line rabaed/no-avoid-terms -- database migrations, not a data import
      latest === undefined ? "No migration or reservation has a day yet." : `Latest day found: ${latest.day}, from ${latest.sources.join("; ")}.`,
      `Next ${count} free day${count === 1 ? "" : "s"}: ${free.join(", ")}.`,
      `Rows for ${reservationsFile} (fill in the issue${lane === "" ? ", lane" : ""} and purpose):`,
      ...free.map((day) => `| ${day} | RP-nnn | ${lane || "lane"} | purpose |`),
    ],
  };
}

/** `--next <n>` prints free days; anything else checks a spec's issues. */
export async function migrationDays(args: string[], seam: MigrationDaysSeam): Promise<MigrationDaysResult> {
  return args.includes("--next") ? nextFreeDays(args, seam) : unreservedSpecIssues(args, seam);
}

/** The real git and Jira calls, in the repository at `repo`. */
export function realSeam(repo: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): MigrationDaysSeam {
  const git = repoGit(repo);
  return {
    ...realFreeDaySeam(repo, git),
    fetch: () => fetchOrigin(git),
    lane: () => laneOf(readRepoFile(repo, ".env")),
    credentials: () => Boolean(env.JIRA_EMAIL && env.JIRA_API_TOKEN),
    async specDescription(key) {
      const headers = { Authorization: `Basic ${Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64")}`, Accept: "application/json" };
      const response = await fetch(`${JIRA}/rest/api/3/issue/${key}?fields=description`, { headers });
      // Status only: Jira's error text is not echoed into the log.
      if (!response.ok) throw new Error(`Jira GET issue/${key} answered ${response.status}`);
      return ((await response.json()) as { fields: { description: unknown } }).fields.description;
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
