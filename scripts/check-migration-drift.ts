import { resolve } from "node:path";
import { git, migrationsDir } from "./migrations.ts";

// Three checks on the migrations a pull request adds (RP-337, from the RP-311 retro):
//
// - Redefinition drift. Migrations run in name order, so for each function,
//   view or policy the newest-sorting definition wins. When the branch and main
//   both redefine one, git merges without a conflict and one side's body
//   silently replaces the other's (RP-312's app.take_transition, undone by
//   RP-299's later copies). The branch's newest definition must sort after
//   every main definition, and must have been added after the branch merged them.
//   Fix: merge main, then add a new migration, later than every one named,
//   that starts from the newest definition and re-applies the branch's change.
// - Stale overloads. Postgres tells functions apart by argument types, so a
//   `create or replace` with another signature adds a second function. When
//   the branch creates a signature main dropped (RP-312 re-created
//   take_transition's `p_reason` one, which RP-300 had replaced by `p_answers`),
//   or a new overload of a function main redefined out of its sight, both
//   overloads stay. Fix: put the branch's change on main's signature instead
//   (rewrite the branch's migration, it isn't on main yet), or drop the stale
//   signature in a new, later migration.
// - Unique timestamps. Two migrations sharing a YYYYMMDDHHMMSS prefix (RP-317
//   and the RP-311 fix-up) run in an order nobody chose. Fix: rename the
//   branch's migration to a new, later timestamp.
//
// Usage: node scripts/check-migration-drift.ts <base> <head>   (CI: the PR's base and head SHAs; needs their history)
//        node scripts/check-migration-drift.ts --merge-group <group base> <group head>
//          (the merge queue, RP-398: the group's base is main plus the entries
//          ahead; its head merges the PR's head into it, see mergeGroupSides)

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

export interface StaleOverload {
  /** The function and its argument types, e.g. `app.take_transition(uuid, text)`. */
  signature: string;
  /** The branch's migrations that create it. */
  branch: string[];
  /** Main's migrations that drop it or, when none does, that redefine the function out of the branch's sight. */
  main: string[];
}

interface FunctionChange {
  op: "create" | "drop";
  name: string;
  /** Normalised argument types; null for a `drop function` without an argument list (every overload). */
  args: string | null;
}

const functionHead = /\b(?<op>create(?:\s+or\s+replace)?|drop)\s+function\s+(?:if\s+exists\s+)?app\."?(?<name>\w+)"?\s*(?<paren>\()?/gi;
const multiWordTypes = /^(?:double precision|character varying|bit varying|time(?:stamp)? with(?:out)? time zone)\b/;
const typeAliases: Record<string, string> = {
  int: "integer",
  int4: "integer",
  int8: "bigint",
  int2: "smallint",
  bool: "boolean",
  float8: "double precision",
  float4: "real",
  varchar: "character varying",
  "timestamp with time zone": "timestamptz",
  "timestamp without time zone": "timestamp",
  "time with time zone": "timetz",
  "time without time zone": "time",
};

/** One argument's type as Postgres identifies the function by it: no mode, name, default or type modifier. Null for an OUT argument. */
function argumentType(argument: string): string | null {
  let type = argument
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*(?:\bdefault\b|=)[\s\S]*$/, "");
  const mode = /^(in|out|inout|variadic) /.exec(type);
  if (mode?.[1] === "out") return null;
  if (mode) type = type.slice(mode[0].length);
  if (!multiWordTypes.test(type) && type.includes(" ")) type = type.slice(type.indexOf(" ") + 1);
  type = type.replace(/"/g, "").replace(/^(?:pg_catalog|public)\./, "").replace(/\s*\([\d\s,]*\)/, "");
  return typeAliases[type] ?? type;
}

/** The argument list from just after its `(` at `start`, split at its top-level commas. */
function argumentList(sql: string, start: number): string[] {
  const parts: string[] = [];
  let depth = 0;
  let part = "";
  for (const char of sql.slice(start)) {
    if (char === "(") depth++;
    if (char === ")" && depth-- === 0) break;
    if (char === "," && depth === 0) {
      parts.push(part);
      part = "";
    } else part += char;
  }
  return part.trim() ? [...parts, part] : parts;
}

/** The `app` functions a migration creates or drops, by name and argument types, in order. */
export function functionChanges(sql: string): FunctionChange[] {
  const code = sql.replace(comments, "");
  return [...code.matchAll(functionHead)].map((match) => {
    const { op = "", name = "", paren } = match.groups ?? {};
    const args = paren
      ? argumentList(code, match.index + match[0].length)
          .map(argumentType)
          .filter((type) => type !== null)
          .join(", ")
      : null;
    return { op: op.toLowerCase().startsWith("drop") ? "drop" : "create", name: name.toLowerCase(), args };
  });
}

const signatureOf = (name: string, args: string) => `app.${name}(${args})`;

/** The function signatures that exist once these migrations have run in name order. */
function liveSignatures(migrations: Migration[]): Set<string> {
  const live = new Set<string>();
  for (const m of migrations.toSorted((a, b) => (a.name < b.name ? -1 : 1))) {
    for (const { op, name, args } of functionChanges(m.sql)) {
      if (op === "create" && args !== null) live.add(signatureOf(name, args));
      else if (args !== null) live.delete(signatureOf(name, args));
      else for (const signature of live) if (signature.startsWith(`app.${name}(`)) live.delete(signature);
    }
  }
  return live;
}

/**
 * Each signature the branch creates that ends up beside another overload of
 * the same function although main ends without it, because main dropped it
 * (the branch brought back a signature main replaced) or redefined the
 * function in a migration the branch's didn't see. `create or replace` with
 * other argument types makes a second function, so the stale one stays, with
 * its old body and grants (RP-312's app.take_transition).
 */
export function staleOverloads(main: Migration[], branch: BranchMigration[]): StaleOverload[] {
  const onMain = liveSignatures(main);
  const live = [...liveSignatures([...main, ...branch])];
  const changes = (m: Migration, op: FunctionChange["op"], signature: string) =>
    functionChanges(m.sql).some((c) => c.op === op && c.args !== null && signatureOf(c.name, c.args) === signature);
  const stale: StaleOverload[] = [];
  for (const signature of live) {
    const prefix = signature.slice(0, signature.indexOf("(") + 1);
    const creating = branch.filter((m) => changes(m, "create", signature));
    const besideAnother = live.some((other) => other !== signature && other.startsWith(prefix));
    if (onMain.has(signature) || creating.length === 0 || !besideAnother) continue;
    const name = prefix.slice("app.".length, -1);
    const dropping = main.filter((m) => changes(m, "drop", signature));
    const unseen = main.filter((m) => functionChanges(m.sql).some((c) => c.name === name) && creating.some((b) => !b.seen.includes(m.name)));
    const conflicting = dropping.length > 0 ? dropping : unseen;
    if (conflicting.length > 0) stale.push({ signature, branch: creating.map((m) => m.name).toSorted(), main: conflicting.map((m) => m.name).toSorted() });
  }
  return stale;
}

const migrationsAt = (repo: string, commit: string) =>
  git(repo, "ls-tree", "--name-only", `${commit}:${migrationsDir}`)
    .split("\n")
    .filter((name) => name.endsWith(".sql"));
const sqlAt = (repo: string, commit: string, name: string) => git(repo, "show", `${commit}:${migrationsDir}/${name}`);

/**
 * The three checks for a pull request from `head` into `base`. Its migrations
 * are those in `head` and not in `base`; each saw the migrations in the tree of
 * the commit that added it on the branch's first-parent history.
 */
export function migrationProblems(repo: string, base: string, head: string): { drift: Drift[]; overloads: StaleOverload[]; duplicates: string[][] } {
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
  return {
    drift: redefinitionDrift(main, branch),
    overloads: staleOverloads(main, branch),
    duplicates: duplicateTimestamps([...new Set([...onBase, ...onHead])], added),
  };
}

/**
 * The base and head to check for a merge queue entry (GitHub's merge_group
 * event). The merge group's head is a merge commit (merge method: merge
 * commit) whose first parent is the group's base (main plus the entries ahead)
 * and whose second is the PR's head; the PR's migrations are checked from that
 * head, as on its pull request. Anything else throws rather than check the
 * wrong commits.
 */
export function mergeGroupSides(repo: string, groupBase: string, groupHead: string): { base: string; head: string } {
  const [commit, ...parents] = git(repo, "rev-list", "--parents", "-n", "1", groupHead).trim().split(" ");
  if (parents.length !== 2) throw new Error(`The merge group's head ${commit} is not a merge of two parents (it has ${parents.length}); is the merge method still "merge commit"?`);
  const base = git(repo, "rev-parse", "--verify", `${groupBase}^{commit}`).trim();
  if (parents[0] !== base) throw new Error(`The merge group's head ${commit} has first parent ${parents[0]}, not the group's base ${base}.`);
  return { base, head: parents[1] as string };
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  const args = process.argv.slice(2);
  const mergeGroup = args[0] === "--merge-group";
  const [first, second] = mergeGroup ? args.slice(1) : args;
  if (!first || !second) {
    console.error("Usage: node scripts/check-migration-drift.ts <base> <head>\n       node scripts/check-migration-drift.ts --merge-group <group base> <group head>");
    process.exit(2);
  }
  const { base, head } = mergeGroup ? mergeGroupSides(process.cwd(), first, second) : { base: first, head: second };
  const { drift, overloads, duplicates } = migrationProblems(process.cwd(), base, head);
  for (const { object, branch, main } of drift) {
    console.error(`${object} is redefined on this branch (${branch.join(", ")}) and on main (${main.join(", ")}).`);
    console.error("  Merge main, then redefine it in a new migration that sorts after all of these: start from the newest body and re-apply this branch's change.");
  }
  for (const { signature, branch, main } of overloads) {
    console.error(`${signature} is created on this branch (${branch.join(", ")}) beside another overload; main dropped that signature, or redefined the function out of this branch's sight (${main.join(", ")}).`);
    console.error("  A different argument list makes a second function, so the stale one stays with its old body and grants. Make this branch's change on main's signature instead: rewrite the branch's migration (it isn't on main yet), or drop the stale signature in a new, later migration.");
  }
  for (const group of duplicates) console.error(`These migrations share a timestamp; rename this branch's (it isn't on main yet) to a new, later one: ${group.join(", ")}`);
  if (drift.length > 0 || overloads.length > 0 || duplicates.length > 0) process.exit(1);
  console.log("No migration redefined on both sides of a merge, no stale overloads, and no shared timestamps.");
}
