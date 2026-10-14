import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseReservations, reservationsFile } from "./check-migrations-days.ts";
import { composeProjectOfEnv } from "./lanes.ts";
import { migrationsDir } from "./migrations.ts";

// `pnpm migration:new <name> --issue RP-nnn` (RP-583, from the RP-580 / RP-582
// retro): creates a migration on the first day after every migration on
// origin/main and every remote branch (the merge queue's gh-readonly-queue/*
// too), every day planning/migration-days.md reserves and every migration in
// this worktree, and reserves that day for the issue. Lanes that picked a day
// by hand were overtaken by main: PR #199 left the queue four times on
// `migrations immutable`, each time a full CI run.
// The git and file calls sit behind NewMigrationSeam so the tests touch no repo.

export interface NewMigrationSeam {
  /** `git fetch origin --prune`; false when it fails. */
  fetch(): boolean;
  /** The migrations' file names on every origin branch, origin/main included. */
  remoteMigrations(): string[];
  /** The migrations' file names in this worktree. */
  localMigrations(): string[];
  /** The reservations file's text on origin/main, then in this worktree ("" when missing). */
  reservations(): [onMain: string, here: string];
  /** This worktree's lane, from its .env; "" when it has none. */
  lane(): string;
  /** Today as `yyyymmdd`, for a repository with no migrations or reservations yet. */
  today(): string;
  /** Writes a file, relative to the repository root. */
  write(path: string, text: string): void;
}

export interface NewMigrationResult {
  ok: boolean;
  lines: string[];
}

// eslint-disable-next-line rabaed/no-avoid-terms -- a migration file's name, not a person's
const usage = "Usage: pnpm migration:new <name> --issue RP-nnn   (name in snake_case, e.g. card_layout)";
const fail = (...lines: string[]): NewMigrationResult => ({ ok: false, lines });

/** A date's UTC day as `yyyymmdd`. */
export const dayOfDate = (date: Date): string => date.toISOString().slice(0, 10).replaceAll("-", "");

/** The calendar day after `day` (`yyyymmdd`). */
export const nextDay = (day: string): string => dayOfDate(new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)) + 1)));

/** The lane a .env's compose project names (`rabaed-lane5` → `5`); "" for any other. */
export const laneOf = (env: string): string => /^rabaed-lane(\w+)$/.exec(composeProjectOfEnv(env) ?? "")?.[1] ?? "";

/** The text with `row` after its last table row (so text after the table stays after it); at the end when it has no table. */
export function withRow(text: string, row: string): string {
  const lines = text.split("\n");
  const last = lines.findLastIndex((line) => line.startsWith("|"));
  if (last === -1) return `${text}${text === "" || text.endsWith("\n") ? "" : "\n"}${row}\n`;
  return [...lines.slice(0, last + 1), row, ...lines.slice(last + 1)].join("\n");
}

export function newMigration(args: string[], seam: NewMigrationSeam): NewMigrationResult {
  const issueFlag = args.indexOf("--issue");
  const issue = issueFlag === -1 ? undefined : args[issueFlag + 1];
  const name = args.find((arg, index) => !arg.startsWith("--") && (issueFlag === -1 || index !== issueFlag + 1));
  if (name === undefined || issue === undefined || !/^RP-\d+$/.test(issue)) return fail(usage);
  if (!/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(name)) return fail(`"${name}" is not snake_case: lowercase letters and digits, words joined by single underscores.`, usage);

  if (!seam.fetch()) return fail("git fetch origin failed; the free day needs today's main and branches. Get online and run `pnpm migration:new` again.");

  const [onMain, onBranch] = seam.reservations();
  const days = [
    ...[...seam.remoteMigrations(), ...seam.localMigrations()].map((file) => file.slice(0, 8)).filter((day) => /^\d{8}$/.test(day)),
    ...[...parseReservations(onMain), ...parseReservations(onBranch)].map((r) => r.day),
  ];
  const latest = days.reduce((max, day) => (day > max ? day : max), "");
  const day = latest === "" ? seam.today() : nextDay(latest);

  const file = `${migrationsDir}/${day}000000_${name}.sql`;
  seam.write(file, `-- ${issue}: ${name.replaceAll("_", " ")}.\n`);
  seam.write(reservationsFile, withRow(onBranch, `| ${day} | ${issue} | ${seam.lane()} | ${name} |`));
  return { ok: true, lines: [`Created ${file}`, `Reserved ${day} for ${issue} in ${reservationsFile}; commit both together.`] };
}

/** The real git and file calls, in the repository at `repo`. */
export function realSeam(repo: string = process.cwd()): NewMigrationSeam {
  const git = (...args: string[]) => spawnSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const lines = (text: string) => text.split("\n").filter(Boolean);
  const read = (path: string) => (existsSync(join(repo, path)) ? readFileSync(join(repo, path), "utf8") : "");
  return {
    fetch: () => git("fetch", "origin", "--prune").status === 0,
    remoteMigrations: () =>
      lines(git("for-each-ref", "--format=%(refname)", "refs/remotes/origin").stdout)
        .filter((ref) => ref !== "refs/remotes/origin/HEAD")
        // A branch without the migrations folder has none: ls-tree fails, stdout is empty.
        .flatMap((ref) => lines(git("ls-tree", "--name-only", `${ref}:${migrationsDir}`).stdout))
        .filter((name) => name.endsWith(".sql")),
    localMigrations: () => readdirSync(join(repo, migrationsDir)).filter((name) => name.endsWith(".sql")),
    reservations: () => [git("show", `origin/main:${reservationsFile}`).stdout ?? "", read(reservationsFile)],
    lane: () => laneOf(read(".env")),
    today: () => dayOfDate(new Date()),
    write: (path, text) => writeFileSync(join(repo, path), text),
  };
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  const result = newMigration(process.argv.slice(2), realSeam());
  for (const line of result.lines) (result.ok ? console.log : console.error)(line);
  process.exit(result.ok ? 0 : 1);
}
