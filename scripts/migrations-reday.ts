import { spawnSync } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { branchIssue, formatReservation, headerIssue, parseReservations, type Reservation, reservationsFile } from "./check-migrations-days.ts";
import { laneOf } from "./lanes.ts";
import { withRow } from "./migration-new.ts";
import { fetchOrigin, freeDay, type FreeDaySeam, type Git, nextDay, readRepoFile, realFreeDaySeam, repoGit } from "./migration-free-days.ts";
import { type Migration, migrationsDir } from "./migrations.ts";

// `pnpm migrations:reday` (RP-988, from the spec RP-631 retro): moves every
// migration this branch adds over origin/main past main's newest migration and
// every remote branch's migrations and reservations, in one command. Spec
// RP-631's migrations moved eight times as main overtook them, each time by a
// hand-written script, and those scripts broke: a `set -e` grep pipeline
// stopped halfway, and an "Unused" row left on a day another issue then took
// made `pnpm check:migrations` refuse that issue's migration.
//
// The days come from freeDay (scripts/migration-free-days.ts, as
// `pnpm migration:new`), with this branch's own migrations and rows left out,
// so the branch doesn't move past itself (its copies on origin included). The
// migrations keep their order, time of day and body (so the issue key in the
// header stays); each old day moves to the next free day. References to the old
// file names elsewhere in the repository are rewritten. In
// planning/migration-days.md the branch's rows on the old days, and every
// "Unused" row of its issues, go; each moved day gets a row with the old row's
// issue and purpose. Then the move is committed and `pnpm check:migrations`
// runs. A worktree with uncommitted changes is refused, so the commit holds
// only the move.
//
// redayChanges is the pure seam the tests drive; the git and file calls are below it.

export interface RedayInput {
  /** The migrations this branch adds over origin/main, any order. */
  added: Migration[];
  /** What freeDay scans: main, every remote branch, this worktree. This branch's own migrations and rows are left out here. */
  days: FreeDaySeam;
  /** This worktree's planning/migration-days.md. */
  daysFile: string;
  /** Files that may name the old migrations, by path, with their text. */
  references: Map<string, string>;
  /** This worktree's lane; "" when it has none (the old row's lane is kept). */
  lane: string;
  /** The current branch's name; null on a detached HEAD. */
  branch: string | null;
}

export interface Move {
  from: string;
  to: string;
  /** The migration's body, unchanged. */
  sql: string;
}

export interface RedayChanges {
  /** In the migrations' order; empty when none has to move. */
  moves: Move[];
  /** The new planning/migration-days.md text. */
  daysFile: string;
  /** Only the files whose text changed, with their new text. */
  references: Map<string, string>;
  warnings: string[];
  /** Why nothing can move; with any, nothing moves. */
  problems: string[];
}

const issuesOf = (text: string) => text.match(/\bRP-\d+\b/g) ?? [];
const stem = (name: string) => name.replace(/\.sql$/, "");
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const movedSuffix = /\s*\(moved from [^)]*\)\s*$/;

/** The text without the reservation rows `drop` matches; every other line kept as it is. */
function withoutRows(text: string, drop: (reservation: Reservation) => boolean): string {
  return text
    .split("\n")
    .filter((line) => {
      const [reservation] = parseReservations(line);
      return reservation === undefined || !drop(reservation);
    })
    .join("\n");
}

export function redayChanges(input: RedayInput): RedayChanges {
  const added = [...input.added].sort((a, b) => a.name.localeCompare(b.name));
  const ownBranchIssue = input.branch === null ? null : branchIssue(input.branch);
  const ownerOf = (migration: Migration) => headerIssue(migration.sql) ?? ownBranchIssue;
  const nothing: Omit<RedayChanges, "problems"> = { moves: [], daysFile: input.daysFile, references: new Map(), warnings: [] };

  const problems = added
    .filter((migration) => ownerOf(migration) === null)
    // eslint-disable-next-line rabaed/no-avoid-terms -- a migration file's first comment line, not a page header
    .map(({ name }) => `${name} names no issue: its header's first line has no RP-nnn and the branch isn't named RP-nnn-…. Add \`-- RP-nnn: …\` as its first line.`);
  if (problems.length > 0) return { ...nothing, problems };
  if (added.length === 0) return { ...nothing, problems: [] };

  // The issues each old day's migrations are for, and every issue of the branch.
  const byDay = new Map<string, Migration[]>();
  for (const migration of added) byDay.set(migration.name.slice(0, 8), [...(byDay.get(migration.name.slice(0, 8)) ?? []), migration]);
  const dayIssues = new Map([...byDay].map(([day, migrations]) => [day, new Set([ownBranchIssue, ...migrations.map(ownerOf)].filter((issue) => issue !== null))]));
  const ownIssues = new Set([...dayIssues.values()].flatMap((issues) => [...issues]));
  const isOwnRow = (r: Reservation) => issuesOf(r.owner).some((issue) => dayIssues.get(r.day)?.has(issue) === true);
  const isOwnUnused = (r: Reservation) => /^unused\b/i.test(r.purpose) && issuesOf(r.owner).some((issue) => ownIssues.has(issue));
  const isOurs = (r: Reservation) => isOwnRow(r) || isOwnUnused(r);

  // freeDay over everything but this branch's own migrations and rows.
  const addedNames = new Set(added.map(({ name }) => name));
  const others: FreeDaySeam = {
    remoteBranches: () =>
      input.days.remoteBranches().map((branch) => ({
        ...branch,
        migrations: branch.migrations.filter((name) => !addedNames.has(name)),
        reservations: () => withoutRows(branch.reservations(), isOurs),
      })),
    localMigrations: () => input.days.localMigrations().filter((name) => !addedNames.has(name)),
    reservations: () => {
      const [onMain, here] = input.days.reservations();
      return [withoutRows(onMain, isOurs), withoutRows(here, isOurs)];
    },
    today: () => input.days.today(),
  };
  const { first, warnings } = freeDay(others);
  const oldDays = [...byDay.keys()];
  if ((oldDays[0] as string) >= first) return { ...nothing, warnings, problems: [] };

  // Each old day, in order, onto the next free day.
  const newDay = new Map<string, string>();
  let day = first;
  for (const old of oldDays) {
    newDay.set(old, day);
    day = nextDay(day);
  }
  const moves = added.map(({ name, sql }) => ({ from: name, to: `${newDay.get(name.slice(0, 8))}${name.slice(8)}`, sql }));

  // The rows: the branch's old ones go, each moved day gets its own.
  const oldRows = parseReservations(input.daysFile).filter(isOwnRow);
  const newRows = oldDays.flatMap((old) => {
    const to = newDay.get(old) as string;
    const rows = oldRows.filter((r) => r.day === old);
    if (rows.length > 0) return rows.map((r) => ({ day: to, owner: r.owner, lane: input.lane || r.lane, purpose: `${r.purpose.replace(movedSuffix, "")} (moved from ${old})` }));
    const migrations = byDay.get(old) as Migration[];
    const purpose = migrations.map(({ name }) => stem(name).slice(15)).join(", ");
    return [{ day: to, owner: ownerOf(migrations[0] as Migration) as string, lane: input.lane, purpose: `${purpose} (moved from ${old})` }];
  });
  const daysFile = newRows.reduce((text, r) => withRow(text, `| ${formatReservation(r)} |`), withoutRows(input.daysFile, isOurs));

  // The references, in one pass, so a name moved onto another's old name isn't moved twice.
  const renames = new Map(moves.map(({ from, to }) => [stem(from), stem(to)]));
  const pattern = new RegExp([...renames.keys()].sort((a, b) => b.length - a.length).map(escape).join("|"), "g");
  const references = new Map<string, string>();
  for (const [path, text] of input.references) {
    const rewritten = text.replace(pattern, (old) => renames.get(old) as string);
    if (rewritten !== text) references.set(path, rewritten);
  }

  return { moves, daysFile, references, warnings, problems: [] };
}

/** The real run: refuse a dirty worktree, fetch, work out the changes, write, commit, then `pnpm check:migrations`. */
export function reday(repo: string = process.cwd(), git: Git = repoGit(repo)): number {
  const say = (line: string) => console.log(line);
  const fail = (...lines: string[]) => {
    for (const line of lines) console.error(line);
    return 1;
  };
  if (git("status", "--porcelain").stdout.trim() !== "") return fail("This worktree has uncommitted changes. Commit them (or set them aside) first: `pnpm migrations:reday` commits only the move.");
  if (!fetchOrigin(git)) return fail("git fetch origin failed; the free days need today's main and branches. Get online and run `pnpm migrations:reday` again.");

  const onMain = new Set(git("ls-tree", "--name-only", `origin/main:${migrationsDir}`).stdout.split("\n").filter(Boolean));
  const days = realFreeDaySeam(repo, git);
  const added = days
    .localMigrations()
    .filter((name) => !onMain.has(name))
    .map((name) => ({ name, sql: readFileSync(join(repo, migrationsDir, name), "utf8") }));
  if (added.length === 0) {
    // eslint-disable-next-line rabaed/no-avoid-terms -- database migrations, not a data import
    say("This branch adds no migration over origin/main: nothing to move.");
    return check(repo);
  }

  // The files that name an old migration, outside the migrations and the reservations file.
  const grepArgs = ["grep", "-l", "-F", ...added.flatMap(({ name }) => ["-e", stem(name)]), "--", ".", `:!${migrationsDir}`, `:!${reservationsFile}`];
  const paths = git(...grepArgs).stdout.split("\n").filter(Boolean);
  const branch = git("rev-parse", "--abbrev-ref", "HEAD").stdout.trim();
  const changes = redayChanges({
    added,
    days,
    daysFile: readRepoFile(repo, reservationsFile),
    references: new Map(paths.map((path) => [path, readRepoFile(repo, path)])),
    lane: laneOf(readRepoFile(repo, ".env")),
    branch: branch === "HEAD" ? null : branch,
  });
  for (const line of changes.warnings) say(line);
  if (changes.problems.length > 0) return fail(...changes.problems);
  if (changes.moves.length === 0) {
    say(`This branch's ${added.length} migration${added.length === 1 ? " is" : "s are"} already past main's newest and every branch's reservations: nothing to move.`);
    return check(repo);
  }

  for (const { from } of changes.moves) unlinkSync(join(repo, migrationsDir, from));
  for (const { to, sql } of changes.moves) writeFileSync(join(repo, migrationsDir, to), sql);
  writeFileSync(join(repo, reservationsFile), changes.daysFile);
  for (const [path, text] of changes.references) writeFileSync(join(repo, path), text);
  for (const { from, to } of changes.moves) say(`Moved ${from} -> ${to}`);
  for (const path of changes.references.keys()) say(`Rewrote the references in ${path}`);

  const touched = [...changes.moves.flatMap(({ from, to }) => [`${migrationsDir}/${from}`, `${migrationsDir}/${to}`]), reservationsFile, ...changes.references.keys()];
  // eslint-disable-next-line rabaed/no-avoid-terms -- database migrations, not a data import
  const issue = (branch === "HEAD" ? null : branchIssue(branch)) ?? headerIssue(added[0]?.sql ?? "") ?? "Migrations";
  if (git("add", "-A", "--", ...touched).status !== 0) return fail("git add failed; the move is written but not committed.");
  // eslint-disable-next-line rabaed/no-avoid-terms -- database migrations, not a data import
  if (git("commit", "-m", `${issue}: move migrations past main's newest (pnpm migrations:reday)`).status !== 0) return fail("git commit failed; the move is written and staged but not committed.");
  say(`Committed the move. ${reservationsFile} has the new rows.`);
  return check(repo);
}

/** `pnpm check:migrations`, its output shown as it runs; its exit status. */
function check(repo: string): number {
  return spawnSync(process.execPath, ["scripts/check-migrations.ts"], { cwd: repo, stdio: "inherit" }).status ?? 1;
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  process.exit(reday());
}
