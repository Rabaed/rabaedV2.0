import { git, type Migration, migrationNames, migrationSql } from "./migrations.ts";

// Migration days (RP-560): `planning/migration-days.md` reserves a day of
// migration timestamps (`yyyymmdd`) for one issue or spec, one line per day:
// `yyyymmdd | RP-nnn (or spec) | lane | purpose`. A migration a branch adds on a
// day reserved for another issue is refused: RP-525 reserved 20270117 for its
// review fixes in a comment, another lane used it on main, and PR #180 had to
// rename its migration. `pnpm check:migrations` runs this beside the drift check.

/** The reservations file, relative to the repository root. */
export const reservationsFile = "planning/migration-days.md";

export interface Reservation {
  day: string;
  /** The issue or spec the day is for, e.g. `RP-437` or `spec RP-525`. */
  owner: string;
  lane: string;
  purpose: string;
}

const issues = (text: string) => text.match(/\bRP-\d+\b/g) ?? [];

/** The reservations in the file's text: each table row that starts with a day. */
export function parseReservations(text: string): Reservation[] {
  const row = /^\|\s*(\d{8})\s*\|([^|]*)\|([^|]*)\|([^|]*)\|\s*$/;
  return text.split(/\r?\n/).flatMap((line) => {
    const match = row.exec(line);
    if (!match) return [];
    const [, day = "", owner = "", lane = "", purpose = ""] = match;
    return [{ day, owner: owner.trim(), lane: lane.trim(), purpose: purpose.trim() }];
  });
}

/** The issues the reservations name (`spec RP-525` names RP-525). */
export const reservedIssues = (reservations: Reservation[]): Set<string> => new Set(reservations.flatMap((r) => issues(r.owner)));

/** A reservation as the file's row says it, for a message. */
export const formatReservation = ({ day, owner, lane, purpose }: Reservation): string => `${day} | ${owner} | ${lane} | ${purpose}`;

/** A migration on a day reserved for another issue, with that reservation. */
export interface RefusedMigration {
  name: string;
  reservation: Reservation;
}

/** What the day check finds in a branch's new migrations. */
export interface DayProblems {
  refused: RefusedMigration[];
  /** Migrations on a day nobody reserved. */
  unreserved: string[];
}

/**
 * The reservations a check goes by: origin/main's, plus the branch's for the
 * days main doesn't reserve. Main's reservation of a day wins, so a branch
 * can't add its own line for a day main reserves for another issue.
 */
export function combineReservations(onMain: Reservation[], onBranch: Reservation[]): Reservation[] {
  const mainDays = new Set(onMain.map((r) => r.day));
  return [...onMain, ...onBranch.filter((r) => !mainDays.has(r.day))];
}

/** The issue a branch named `RP-nnn-…` is for; null for any other name. */
export function branchIssue(branch: string): string | null {
  return /^(RP-\d+)-/.exec(branch)?.[1] ?? null;
}

/**
 * The issue a migration's header is for: the first issue on its first line,
 * when that is a `--` comment. Issues named after it, or further down, are
 * mentions, not owners ("-- … rebuilt from RP-437's …").
 */
export function headerIssue(sql: string): string | null {
  const comment = /^\s*--(.*)$/.exec(sql.split(/\r?\n/, 1)[0] ?? "")?.[1];
  return comment === undefined ? null : (issues(comment)[0] ?? null);
}

/**
 * The added migrations on a day reserved for another issue, each with the
 * reservation, and those on a day nobody reserved. A migration is the
 * branch's issue's (from its name, `RP-nnn-…`) and the first issue on its
 * header's first line, so an integration branch's migrations pass on their
 * issues' days.
 */
export function dayProblems(added: Migration[], reservations: Reservation[], branch: string | null): DayProblems {
  const refused: RefusedMigration[] = [];
  const unreserved: string[] = [];
  for (const { name, sql } of added) {
    const onDay = reservations.filter((r) => r.day === name.slice(0, 8));
    if (onDay.length === 0) {
      unreserved.push(name);
      continue;
    }
    const own = new Set([branch, headerIssue(sql)].filter((issue) => issue !== null));
    if (!onDay.some((r) => issues(r.owner).some((issue) => own.has(issue)))) refused.push({ name, reservation: onDay[0] as Reservation });
  }
  return { refused, unreserved };
}

/** A file's text at a commit; empty when the commit doesn't have it. */
function fileAt(repo: string, commit: string, path: string): string {
  return git(repo, "ls-tree", "--name-only", commit, "--", path).trim() ? git(repo, "show", `${commit}:${path}`) : "";
}

/** The day check for the migrations `head` adds over `base`, with `base`'s reservations and `head`'s for the days `base` doesn't reserve. */
export function migrationDays(repo: string, base: string, head: string, branch: string | null): DayProblems {
  const onBase = new Set(migrationNames(repo, base));
  const added = migrationNames(repo, head)
    .filter((name) => !onBase.has(name))
    .map((name) => ({ name, sql: migrationSql(repo, head, name) }));
  const reservations = combineReservations(parseReservations(fileAt(repo, base, reservationsFile)), parseReservations(fileAt(repo, head, reservationsFile)));
  return dayProblems(added, reservations, branch);
}
