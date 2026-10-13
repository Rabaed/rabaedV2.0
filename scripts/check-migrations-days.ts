import { git, migrationsDir } from "./migrations.ts";

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

/** The reservations in the file's text: each line that starts with a day, as a table row or a plain line. */
export function parseReservations(text: string): Reservation[] {
  const row = /^\|?\s*(\d{8})\s*\|([^|]*)\|([^|]*)\|([^|]*?)\|?\s*$/;
  return text.split(/\r?\n/).flatMap((line) => {
    const match = row.exec(line);
    if (!match) return [];
    const [, day = "", owner = "", lane = "", purpose = ""] = match;
    return [{ day, owner: owner.trim(), lane: lane.trim(), purpose: purpose.trim() }];
  });
}

/** The issue a branch named `RP-nnn-…` is for; null for any other name. */
export function branchIssue(branch: string): string | null {
  return /^(RP-\d+)-/.exec(branch)?.[1] ?? null;
}

/** The issues a migration's header names: the `--` lines it starts with, up to the first empty one. */
function headerIssues(sql: string): string[] {
  const header: string[] = [];
  for (const line of sql.split(/\r?\n/)) {
    const comment = /^\s*--(.*)$/.exec(line)?.[1];
    if (comment === undefined || !comment.trim()) break;
    header.push(comment);
  }
  return issues(header.join("\n"));
}

/**
 * The added migrations on a day reserved for another issue, each with the
 * reservation, and those on a day nobody reserved. A migration is the
 * branch's issue's (from its name, `RP-nnn-…`) and every issue its header
 * names, so an integration branch's migrations pass on their issues' days.
 */
export function dayProblems(added: { name: string; sql: string }[], reservations: Reservation[], branch: string | null): { refused: { name: string; reservation: Reservation }[]; unreserved: string[] } {
  const refused: { name: string; reservation: Reservation }[] = [];
  const unreserved: string[] = [];
  for (const { name, sql } of added) {
    const onDay = reservations.filter((r) => r.day === name.slice(0, 8));
    if (onDay.length === 0) {
      unreserved.push(name);
      continue;
    }
    const own = new Set([...(branch ? [branch] : []), ...headerIssues(sql)]);
    if (!onDay.some((r) => issues(r.owner).some((issue) => own.has(issue)))) refused.push({ name, reservation: onDay[0] as Reservation });
  }
  return { refused, unreserved };
}

/** A file's text at a commit; empty when the commit doesn't have it. */
function fileAt(repo: string, commit: string, path: string): string {
  return git(repo, "ls-tree", "--name-only", commit, "--", path).trim() ? git(repo, "show", `${commit}:${path}`) : "";
}

/** The day check for the migrations `head` adds over `base`, with the reservations of both. */
export function migrationDays(repo: string, base: string, head: string, branch: string | null): ReturnType<typeof dayProblems> {
  const names = (commit: string) =>
    git(repo, "ls-tree", "--name-only", `${commit}:${migrationsDir}`)
      .split("\n")
      .filter((name) => name.endsWith(".sql"));
  const onBase = new Set(names(base));
  const added = names(head)
    .filter((name) => !onBase.has(name))
    .map((name) => ({ name, sql: git(repo, "show", `${head}:${migrationsDir}/${name}`) }));
  const reservations = [...parseReservations(fileAt(repo, base, reservationsFile)), ...parseReservations(fileAt(repo, head, reservationsFile))];
  return dayProblems(added, reservations, branch);
}
