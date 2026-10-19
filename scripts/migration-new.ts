import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { reservationsFile } from "./check-migrations-days.ts";
import { laneOf } from "./lanes.ts";
import { fetchOrigin, freeDay, type FreeDaySeam, readRepoFile, realFreeDaySeam, repoGit } from "./migration-free-days.ts";
import { migrationsDir } from "./migrations.ts";

// `pnpm migration:new <name> --issue RP-nnn` (RP-583, from the RP-580 / RP-582
// retro): creates a migration on the first day after every migration on
// origin/main and every remote branch (the merge queue's gh-readonly-queue/*
// too), every day planning/migration-days.md reserves and every migration in
// this worktree, and reserves that day for the issue. Lanes that picked a day
// by hand were overtaken by main: PR #199 left the queue four times on
// `migrations immutable`, each time a full CI run. The day comes from freeDay
// (scripts/migration-free-days.ts), which `pnpm migration:days --next` shares.
// The git and file calls sit behind NewMigrationSeam so the tests touch no repo.

export interface NewMigrationSeam extends FreeDaySeam {
  /** `git fetch origin --prune`; false when it fails. */
  fetch(): boolean;
  /** This worktree's lane, from its .env; "" when it has none. */
  lane(): string;
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

  const { first: day, warnings } = freeDay(seam);
  const [, onBranch] = seam.reservations();
  const file = `${migrationsDir}/${day}000000_${name}.sql`;
  seam.write(file, `-- ${issue}: ${name.replaceAll("_", " ")}.\n`);
  seam.write(reservationsFile, withRow(onBranch, `| ${day} | ${issue} | ${seam.lane()} | ${name} |`));
  return { ok: true, lines: [...warnings, `Created ${file}`, `Reserved ${day} for ${issue} in ${reservationsFile}; commit both together.`] };
}

/** The real git and file calls, in the repository at `repo`. */
export function realSeam(repo: string = process.cwd()): NewMigrationSeam {
  const git = repoGit(repo);
  return {
    ...realFreeDaySeam(repo, git),
    fetch: () => fetchOrigin(git),
    lane: () => laneOf(readRepoFile(repo, ".env")),
    write: (path, text) => writeFileSync(join(repo, path), text),
  };
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  const result = newMigration(process.argv.slice(2), realSeam());
  for (const line of result.lines) (result.ok ? console.log : console.error)(line);
  process.exit(result.ok ? 0 : 1);
}
