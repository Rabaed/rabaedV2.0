import { spawnSync } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { branchIssue, formatReservation, headerIssue, issues, parseReservations, type Reservation, reservationsFile } from "./check-migrations-days.ts";
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
// header stays); each old day moves to the next free day. The branch's rows on
// days it has no migration on yet (a spec's later days) still count, so the
// moved days land after them. References to the old file names elsewhere in the
// repository are rewritten; the migrations themselves, other migrations
// included, are not edited. In planning/migration-days.md the branch's rows on
// the old days go, except a spec's row (`spec RP-nnn`) on a day another branch
// or main still has a migration on (its other tickets share it); every "Unused" row naming the
// branch's issues goes too, even when nothing moves. Each moved day gets a row
// with the old row's issue and purpose (one per issue when it had none) and
// this worktree's lane, as `pnpm migration:new` writes. Then the change is
// committed and `pnpm check:migrations` runs on that commit (it checks HEAD). A
// worktree with uncommitted changes is refused, so the commit holds only the move.
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

/** A migration's day (`yyyymmdd`), and the rest of its name (`hhmmss_name.sql`). */
const dayOf = (name: string) => name.slice(0, 8);
const afterDay = (name: string) => name.slice(8);
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
  for (const migration of added) byDay.set(dayOf(migration.name), [...(byDay.get(dayOf(migration.name)) ?? []), migration]);
  const dayIssues = new Map([...byDay].map(([day, migrations]) => [day, new Set([ownBranchIssue, ...migrations.map(ownerOf)].filter((issue) => issue !== null))]));
  const ownIssues = new Set([...dayIssues.values()].flatMap((set) => [...set]));
  const addedNames = new Set(added.map(({ name }) => name));
  const branches = input.days.remoteBranches().map((branch) => ({ ...branch, migrations: branch.migrations.filter((name) => !addedNames.has(name)) }));
  const localOthers = input.days.localMigrations().filter((name) => !addedNames.has(name));
  // An old day another branch (or main) still has a migration on: a spec's row there (`spec RP-nnn`) stays for its other tickets. A ticket's own row goes even so: left behind, it would block the issue that took the day.
  const sharedDays = new Set(
    [...branches.filter((branch) => branch.migrations.some((name) => byDay.has(dayOf(name))) && branch.sharesHistory()).flatMap((branch) => branch.migrations), ...localOthers]
      .map(dayOf)
      .filter((day) => byDay.has(day)),
  );
  const isOldDayRow = (r: Reservation) => issues(r.owner).some((issue) => dayIssues.get(r.day)?.has(issue) === true);
  const isOwnUnused = (r: Reservation) => /^unused\b/i.test(r.purpose) && issues(r.owner).some((issue) => ownIssues.has(issue));
  const isSharedSpecRow = (r: Reservation) => /^spec\b/i.test(r.owner) && sharedDays.has(r.day);
  const isOurs = (r: Reservation) => (isOldDayRow(r) && !isSharedSpecRow(r)) || isOwnUnused(r);

  // freeDay over everything but this branch's own migrations and rows.
  const others: FreeDaySeam = {
    remoteBranches: () => branches.map((branch) => ({ ...branch, reservations: () => withoutRows(branch.reservations(), isOurs) })),
    localMigrations: () => localOthers,
    reservations: () => {
      const [onMain, here] = input.days.reservations();
      return [withoutRows(onMain, isOurs), withoutRows(here, isOurs)];
    },
    today: () => input.days.today(),
  };
  const { first, warnings } = freeDay(others);
  const oldDays = [...byDay.keys()];
  if ((oldDays[0] ?? "") >= first) return { ...nothing, daysFile: withoutRows(input.daysFile, isOwnUnused), warnings, problems: [] };

  // Each old day, in order, onto the next free day.
  const newDay = new Map<string, string>();
  let day = first;
  for (const old of oldDays) {
    newDay.set(old, day);
    day = nextDay(day);
  }
  const moves = added.map(({ name, sql }) => ({ from: name, to: `${newDay.get(dayOf(name)) ?? ""}${afterDay(name)}`, sql }));

  // The rows: each moved day gets the old day's rows of its issues (else one per issue); the branch's old ones go.
  const oldRows = parseReservations(input.daysFile).filter(isOldDayRow);
  const newRows = oldDays.flatMap((old) => {
    const to = newDay.get(old) ?? "";
    const rows = oldRows.filter((r) => r.day === old);
    if (rows.length > 0) return rows.map((r) => ({ day: to, owner: r.owner, lane: input.lane || r.lane, purpose: `${r.purpose.replace(movedSuffix, "")} (moved from ${old})` }));
    const byOwner = new Map<string, string[]>();
    for (const migration of byDay.get(old) ?? []) {
      const owner = ownerOf(migration) ?? "";
      byOwner.set(owner, [...(byOwner.get(owner) ?? []), stem(afterDay(migration.name)).slice(7)]);
    }
    return [...byOwner].map(([owner, names]) => ({ day: to, owner, lane: input.lane, purpose: `${names.join(", ")} (moved from ${old})` }));
  });
  const daysFile = newRows.reduce((text, r) => withRow(text, `| ${formatReservation(r)} |`), withoutRows(input.daysFile, isOurs));

  // The references, in one pass, so a name moved onto another's old name isn't moved twice.
  const renames = new Map(moves.map(({ from, to }) => [stem(from), stem(to)]));
  const pattern = new RegExp([...renames.keys()].sort((a, b) => b.length - a.length).map(escape).join("|"), "g");
  const references = new Map<string, string>();
  for (const [path, text] of input.references) {
    const rewritten = text.replace(pattern, (old) => renames.get(old) ?? old);
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
    if (changes.daysFile === readRepoFile(repo, reservationsFile)) return check(repo);
    writeFileSync(join(repo, reservationsFile), changes.daysFile);
    // eslint-disable-next-line rabaed/no-avoid-terms -- the reservations file's name, not a data import
    if (git("add", "--", reservationsFile).status !== 0 || git("commit", "-m", `${branchIssue(branch) ?? "Migration days"}: drop this branch's Unused rows (pnpm migrations:reday)`).status !== 0) {
      return fail(`git add or commit failed; ${reservationsFile} is written but not committed.`);
    }
    say(`Committed ${reservationsFile} without this branch's "Unused" rows.`);
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
  say(`Committed the move; ${reservationsFile} has the new rows. If pnpm check:migrations (next) refuses anything, fix it in a new commit.`);
  return check(repo);
}

/** `pnpm check:migrations`, its output shown as it runs; its exit status. */
function check(repo: string): number {
  return spawnSync(process.execPath, ["scripts/check-migrations.ts"], { cwd: repo, stdio: "inherit" }).status ?? 1;
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  process.exit(reday());
}
