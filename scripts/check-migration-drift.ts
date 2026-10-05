import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// Two checks on the migrations a pull request adds (RP-337, from the RP-311 retro):
//
// - Redefinition drift. Migrations run in name order, so for each function,
//   view or policy the newest-sorting definition wins. When the branch and main
//   both redefine one, git merges without a conflict and one side's body
//   silently replaces the other's (RP-312's app.take_transition, undone by
//   RP-299's later copies). The branch's newest definition must sort after
//   every main definition, and must have been added after the branch merged them.
// - Unique timestamps. Two migrations sharing a YYYYMMDDHHMMSS prefix (RP-317
//   and the RP-311 fix-up) run in an order nobody chose.
//
// Usage: node scripts/check-migration-drift.ts <base> <head>   (CI: the PR's base and head SHAs; needs their history)

const migrationsDir = "packages/db/migrations";

export interface Migration {
  name: string;
  sql: string;
}

export interface BranchMigration extends Migration {
  /** The migrations in the tree when the branch added this one: what its author could build on. */
  seen: string[];
}

export interface Drift {
  object: string;
  branch: string[];
  main: string[];
}

// Creating, replacing or dropping an `app` function or view, or a policy.
const definition =
  /\b(?:create(?:\s+or\s+replace)?|drop)\s+(?:(?<kind>function|view)\s+(?:if\s+exists\s+)?app\."?(?<name>\w+)"?|policy\s+(?:if\s+exists\s+)?"?(?<policy>\w+)"?\s+on\s+(?:\w+\.)?"?(?<table>\w+)"?)/gi;
const comments = /--[^\n]*|\/\*[\s\S]*?\*\//g;

/** The objects a migration (re)defines, by kind and name, in the order it first does so. */
export function definedObjects(sql: string): string[] {
  const objects = [...sql.replace(comments, "").matchAll(definition)].map(({ groups = {} }) =>
    (groups.kind ? `${groups.kind} app.${groups.name}` : `policy ${groups.policy} on ${groups.table}`).toLowerCase(),
  );
  return [...new Set(objects)];
}

/**
 * Groups of migrations sharing a `YYYYMMDDHHMMSS` prefix, where the group holds
 * a migration the change adds. A pair already on main stays: it can't be renamed.
 */
export function duplicateTimestamps(files: string[], added: string[]): string[][] {
  const byTimestamp = Map.groupBy(files.filter((file) => /^\d{14}_/.test(file)), (file) => file.slice(0, 14));
  return [...byTimestamp.values()].filter((group) => group.length > 1 && group.some((file) => added.includes(file))).map((group) => group.toSorted());
}

/**
 * Each object the branch (re)defines that main also defines, where a main
 * definition sorts after the branch's newest one (it replaces the branch's
 * body) or the branch's newest one was added without seeing it (it would
 * replace main's body).
 */
export function redefinitionDrift(main: Migration[], branch: BranchMigration[]): Drift[] {
  const drifts: Drift[] = [];
  for (const object of new Set(branch.flatMap((m) => definedObjects(m.sql)))) {
    const defines = (m: Migration) => definedObjects(m.sql).includes(object);
    const onBranch = branch.filter(defines).toSorted((a, b) => (a.name < b.name ? -1 : 1));
    const newest = onBranch.at(-1)!;
    const conflicting = main.filter((m) => defines(m) && (m.name > newest.name || !newest.seen.includes(m.name)));
    if (conflicting.length > 0) drifts.push({ object, branch: onBranch.map((m) => m.name), main: conflicting.map((m) => m.name).toSorted() });
  }
  return drifts;
}

const git = (repo: string, ...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const migrationsAt = (repo: string, commit: string) =>
  git(repo, "ls-tree", "--name-only", `${commit}:${migrationsDir}`)
    .split("\n")
    .filter((name) => name.endsWith(".sql"));
const sqlAt = (repo: string, commit: string, name: string) => git(repo, "show", `${commit}:${migrationsDir}/${name}`);

/**
 * Both checks for a pull request from `head` into `base`. Its migrations are
 * those in `head` and not in `base`; each saw the migrations in the tree of the
 * commit that added it on the branch's first-parent history.
 */
export function migrationProblems(repo: string, base: string, head: string): { drift: Drift[]; duplicates: string[][] } {
  const onBase = migrationsAt(repo, base);
  const onHead = migrationsAt(repo, head);
  const added = onHead.filter((name) => !onBase.includes(name));
  const branch = added.map((name) => {
    // A merge's diff is against its first parent, so a migration a merge brings in counts as added there.
    const log = git(repo, "log", "--first-parent", "--diff-merges=first-parent", "--diff-filter=A", "--no-patch", "-1", "--format=%H", head, "--", `${migrationsDir}/${name}`);
    const addedIn = log.trim();
    if (!addedIn) throw new Error(`No commit on ${head}'s first-parent history adds ${name}`);
    return { name, sql: sqlAt(repo, head, name), seen: migrationsAt(repo, addedIn) };
  });
  const main = onBase.map((name) => ({ name, sql: sqlAt(repo, base, name) }));
  return { drift: redefinitionDrift(main, branch), duplicates: duplicateTimestamps([...new Set([...onBase, ...onHead])], added) };
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  const [base, head] = process.argv.slice(2);
  if (!base || !head) {
    console.error("Usage: node scripts/check-migration-drift.ts <base> <head>");
    process.exit(2);
  }
  const { drift, duplicates } = migrationProblems(process.cwd(), base, head);
  for (const { object, branch, main } of drift) {
    console.error(`${object} is redefined on this branch (${branch.join(", ")}) and on main (${main.join(", ")}).`);
    console.error("  Merge main, then redefine it in a new migration that sorts after all of these: start from the newest body and re-apply this branch's change.");
  }
  for (const group of duplicates) console.error(`These migrations share a timestamp; give this branch's a new, later one: ${group.join(", ")}`);
  if (drift.length > 0 || duplicates.length > 0) {
    console.error("See CODING_STANDARDS.md, Database.");
    process.exit(1);
  }
  console.log("No migration redefined on both sides of a merge, and no shared timestamps.");
}
