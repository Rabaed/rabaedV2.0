import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { combineReservations, parseReservations, reservationsFile } from "./check-migrations-days.ts";
import { migrationsDir } from "./migrations.ts";

// The first free migration day (RP-583, shared since RP-966): the day after
// every migration on origin/main and every remote branch (the merge queue's
// gh-readonly-queue/* too), every day planning/migration-days.md reserves (on
// origin/main and in this worktree) and every migration in this worktree.
// `pnpm migration:new` takes it for one migration; `pnpm migration:days --next n`
// prints it and the days after. A branch with no history in common with main
// (the screenshot baselines' screens-*) holds no real migrations: skipped quietly.
// The git and file calls sit behind FreeDaySeam so the tests touch no repo.

export interface RemoteBranch {
  /** The branch's name on origin, e.g. `main` or `RP-583-migration-new`. */
  name: string;
  /** Its migrations' file names. */
  migrations: string[];
  /** True when it has a merge base with origin/main; asked only of a branch with migrations. */
  sharesHistory: () => boolean;
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
}

/** A date's UTC day as `yyyymmdd`. */
export const dayOfDate = (date: Date): string => date.toISOString().slice(0, 10).replaceAll("-", "");

/** The calendar day after `day` (`yyyymmdd`). */
export const nextDay = (day: string): string => dayOfDate(new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)) + 1)));

const dayOf = (file: string): string | undefined => (/^\d{8}/.test(file) ? file.slice(0, 8) : undefined);

/**
 * The first free day and the latest taken day's sources. A migration main has
 * is main's alone (every branch made from main has it too); one main lacks
 * names each branch that adds it, or this worktree when no branch has it.
 */
export function freeDay(seam: FreeDaySeam): FreeDay {
  const branches = seam.remoteBranches().filter((branch) => branch.migrations.length > 0 && branch.sharesHistory());
  const onMain = new Set(branches.find((branch) => branch.name === "main")?.migrations ?? []);
  const taken: { day: string; source: string }[] = [];
  for (const branch of branches) {
    for (const file of branch.migrations) {
      const day = dayOf(file);
      if (day !== undefined && (branch.name === "main" || !onMain.has(file))) taken.push({ day, source: `branch origin/${branch.name}` });
    }
  }
  const remote = new Set(branches.flatMap((branch) => branch.migrations));
  for (const file of seam.localMigrations()) {
    const day = dayOf(file);
    if (day !== undefined && !remote.has(file)) taken.push({ day, source: "this worktree" });
  }
  const [mainText, hereText] = seam.reservations();
  const mainReservations = parseReservations(mainText);
  for (const reservation of combineReservations(mainReservations, parseReservations(hereText))) {
    const where = mainReservations.includes(reservation) ? "origin/main's" : "this worktree's";
    taken.push({ day: reservation.day, source: `reservation ${reservation.owner} in ${where} ${reservationsFile}` });
  }

  const latest = taken.reduce((max, { day }) => (day > max ? day : max), "");
  if (latest === "") return { first: seam.today() };
  const sources = [...new Set(taken.filter(({ day }) => day === latest).map(({ source }) => source))];
  return { first: nextDay(latest), latest: { day: latest, sources } };
}

/** The real git and file calls, in the repository at `repo` (after the caller's `git fetch`). */
export function realFreeDaySeam(repo: string = process.cwd()): FreeDaySeam {
  const git = (...args: string[]) => spawnSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const lines = (text: string) => text.split("\n").filter(Boolean);
  const read = (path: string) => (existsSync(join(repo, path)) ? readFileSync(join(repo, path), "utf8") : "");
  const prefix = "refs/remotes/origin/";
  return {
    remoteBranches: () =>
      lines(git("for-each-ref", "--format=%(refname)", prefix).stdout)
        .filter((ref) => ref !== `${prefix}HEAD`)
        .map((ref) => ({
          name: ref.slice(prefix.length),
          // A branch without the migrations folder has none: ls-tree fails, stdout is empty.
          migrations: lines(git("ls-tree", "--name-only", `${ref}:${migrationsDir}`).stdout).filter((name) => name.endsWith(".sql")),
          sharesHistory: () => git("merge-base", "origin/main", ref).status === 0,
        })),
    localMigrations: () => readdirSync(join(repo, migrationsDir)).filter((name) => name.endsWith(".sql")),
    reservations: () => [git("show", `origin/main:${reservationsFile}`).stdout ?? "", read(reservationsFile)],
    today: () => dayOfDate(new Date()),
  };
}
