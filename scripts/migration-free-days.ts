import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { formatReservation, parseReservations, reservationsFile } from "./check-migrations-days.ts";
import { migrationsDir } from "./migrations.ts";

// The first free migration day (RP-583, shared since RP-966): the day after
// every migration on origin/main and every remote branch (the merge queue's
// gh-readonly-queue/* too), every day planning/migration-days.md reserves (on
// origin/main, on every remote branch and in this worktree) and every migration
// in this worktree. `pnpm migration:new` takes it for one migration;
// `pnpm migration:days --next n` prints it and the days after. A branch with no
// history in common with main (the screenshot baselines' screens-*) holds no
// real migrations: skipped quietly, unless the clone is shallow and the merge
// base may only be missing. A day that isn't a calendar date (20270230) is
// ignored with a warning, so it can't roll the free day forward.
// The git and file calls sit behind FreeDaySeam so the tests touch no repo.

export interface RemoteBranch {
  /** The branch's name on origin, e.g. `main` or `RP-583-migration-new`. */
  name: string;
  /** Its migrations' file names. */
  migrations: string[];
  /** True when it has a merge base with origin/main; asked only of a branch with migrations. */
  sharesHistory: () => boolean;
  /** Its reservations file's text ("" when missing); read only of a branch that shares history. */
  reservations: () => string;
}

export interface FreeDaySeam {
  /** Every origin branch, origin/main included (origin/HEAD not). */
  remoteBranches(): RemoteBranch[];
  /** The migrations' file names in this worktree. */
  localMigrations(): string[];
  /** The reservations file's text on origin/main, then in this worktree ("" when missing). */
  reservations(): [onMain: string, here: string];
  /** Today as `yyyymmdd`, for a repository with no migrations or reservations yet. */
  today(): string;
}

export interface FreeDay {
  /** The first free day, `yyyymmdd`. */
  first: string;
  /** The latest day taken, and what took it; absent when nothing has a day yet. */
  latest?: { day: string; sources: string[] };
  /** The migrations and rows ignored for a day that isn't a calendar date. */
  warnings: string[];
}

/** A date's UTC day as `yyyymmdd`. */
export const dayOfDate = (date: Date): string => date.toISOString().slice(0, 10).replaceAll("-", "");

const utc = (day: string, plus = 0) => new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)) + plus));

/** The calendar day after `day` (`yyyymmdd`). */
export const nextDay = (day: string): string => dayOfDate(utc(day, 1));

/** True when `yyyymmdd` is a real date: not 20270230 or 20271399, which Date would roll forward. */
export const isCalendarDay = (day: string): boolean => /^\d{8}$/.test(day) && dayOfDate(utc(day)) === day;

/**
 * The first free day and the latest taken day's sources. A migration main has
 * is main's alone (every branch made from main has it too); one main lacks
 * names each branch that adds it, or this worktree when no branch has it. A
 * reservation row is named after the first file that has it: origin/main's,
 * this worktree's, then each branch's.
 */
export function freeDay(seam: FreeDaySeam): FreeDay {
  const branches = seam.remoteBranches().filter((branch) => branch.migrations.length > 0 && branch.sharesHistory());
  const onMain = new Set(branches.find((branch) => branch.name === "main")?.migrations ?? []);
  const taken: { day: string; source: string }[] = [];
  const warnings: string[] = [];
  const take = (day: string, source: string, what: string) => {
    if (isCalendarDay(day)) taken.push({ day, source });
    else warnings.push(`Warning: ignored ${what}: ${day} is not a calendar date.`);
  };

  for (const branch of branches) {
    for (const file of branch.migrations) {
      if (/^\d{8}/.test(file) && (branch.name === "main" || !onMain.has(file))) take(file.slice(0, 8), `branch origin/${branch.name}`, `origin/${branch.name}'s migration ${file}`);
    }
  }
  const remote = new Set(branches.flatMap((branch) => branch.migrations));
  for (const file of seam.localMigrations()) {
    // eslint-disable-next-line rabaed/no-avoid-terms -- database migrations, not a data import
    if (/^\d{8}/.test(file) && !remote.has(file)) take(file.slice(0, 8), "this worktree", `this worktree's migration ${file}`);
  }

  const [mainText, hereText] = seam.reservations();
  const files: [where: string, text: string][] = [
    ["origin/main's", mainText],
    ["this worktree's", hereText],
    ...branches.filter((branch) => branch.name !== "main").map((branch): [string, string] => [`origin/${branch.name}'s`, branch.reservations()]),
  ];
  const seen = new Set<string>();
  for (const [where, text] of files) {
    for (const reservation of parseReservations(text)) {
      const row = formatReservation(reservation);
      if (seen.has(row)) continue;
      seen.add(row);
      take(reservation.day, `reservation ${reservation.owner} in ${where} ${reservationsFile}`, `the row ${row} in ${where} ${reservationsFile}`);
    }
  }

  const latest = taken.reduce((max, { day }) => (day > max ? day : max), "");
  if (latest === "") return { first: seam.today(), warnings };
  const sources = [...new Set(taken.filter(({ day }) => day === latest).map(({ source }) => source))];
  return { first: nextDay(latest), latest: { day: latest, sources }, warnings };
}

/** A git command's exit status and output. */
export type Git = (...args: string[]) => { status: number | null; stdout: string };

/** Git in the repository at `repo`. */
export const repoGit =
  (repo: string): Git =>
  (...args) => {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return { status: result.status, stdout: result.stdout ?? "" };
  };

/** `git fetch origin --prune`, every branch; false when it fails. */
export const fetchOrigin = (git: Git): boolean => git("fetch", "origin", "--prune").status === 0;

/** A file's text, relative to the repository root; "" when missing. */
export const readRepoFile = (repo: string, path: string): string => (existsSync(join(repo, path)) ? readFileSync(join(repo, path), "utf8") : "");

/** The real git and file calls, in the repository at `repo` (after the caller's fetch). */
export function realFreeDaySeam(repo: string = process.cwd(), git: Git = repoGit(repo)): FreeDaySeam {
  const lines = (text: string) => text.split("\n").filter(Boolean);
  const prefix = "refs/remotes/origin/";
  let shallow: boolean | undefined;
  // In a shallow clone a missing merge base may only be history not fetched: count the branch.
  const isShallow = () => (shallow ??= git("rev-parse", "--is-shallow-repository").stdout.trim() === "true");
  return {
    remoteBranches: () =>
      lines(git("for-each-ref", "--format=%(refname)", prefix).stdout)
        .filter((ref) => ref !== `${prefix}HEAD`)
        .map((ref) => ({
          name: ref.slice(prefix.length),
          // A branch without the migrations folder has none: ls-tree fails, stdout is empty.
          migrations: lines(git("ls-tree", "--name-only", `${ref}:${migrationsDir}`).stdout).filter((name) => name.endsWith(".sql")),
          sharesHistory: () => git("merge-base", "origin/main", ref).status === 0 || isShallow(),
          reservations: () => git("show", `${ref}:${reservationsFile}`).stdout,
        })),
    localMigrations: () => readdirSync(join(repo, migrationsDir)).filter((name) => name.endsWith(".sql")),
    reservations: () => [git("show", `origin/main:${reservationsFile}`).stdout, readRepoFile(repo, reservationsFile)],
    today: () => dayOfDate(new Date()),
  };
}
