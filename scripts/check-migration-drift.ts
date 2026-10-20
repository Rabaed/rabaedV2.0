import { resolve } from "node:path";
import { reportHiddenSortKeys } from "./check-migrations-hidden-sort.ts";
import { git, type Migration, migrationBlobs, migrationNames, migrationSql, migrationsDir } from "./migrations.ts";

// Five checks on the migrations a pull request adds (RP-337, from the RP-311 retro;
// the fifth from RP-534):
//
// - Redefinition drift. Migrations run in name order, so for each function,
//   view or policy the newest-sorting definition wins. When the branch and main
//   both redefine one, git merges without a conflict and one side's body
//   silently replaces the other's (RP-312's app.take_transition, undone by
//   RP-299's later copies). The branch's newest definition must sort after
//   every main definition, and must have been added after the branch merged them.
//   Fix: merge main, then add a new migration, later than every one named,
//   that starts from the newest definition and re-applies the branch's change.
//   A table constraint dropped or added in an `alter table` counts as an object
//   too (RP-963: RP-643 and RP-155 each rebuilt notification_kind_check from only
//   the kinds they knew, and the later-sorting one dropped the other's kind); its
//   fix rebuilds it with both sides' change. Its table may be quoted or
//   schema-qualified; an `alter table` inside a function body doesn't count (it
//   runs when called), one inside a `do` block does.
// - Branch order (RP-457). Two migrations on one branch that redefine the same
//   object (two implementers building in parallel, merged onto an integration
//   branch) can each start from the same old body; the one that sorts later
//   silently replaces the other (RP-449's WF-7 and WF-8 both redefining
//   app.take_transition). Each must have seen the previous one that defines the
//   object. Fix: add a new migration, sorting after both and written with both in
//   the tree, that starts from the later one's body and re-applies the earlier one's
//   change (editing the later one doesn't count: it is judged by the commit that added it).
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
// - Hidden sort keys (RP-534, check-migrations-hidden-sort.ts). A branch
//   migration that sorts by a column the visibility rules hide
//   (scripts/hidden-columns.ts). Fix: sort by a value the viewer may see, or
//   say why the order reveals nothing in a `-- hidden-sort-key:` comment.
//
// Usage: node scripts/check-migration-drift.ts <base> <head>   (CI: the PR's base and head SHAs; needs their history)
//        node scripts/check-migration-drift.ts --merge-group <group base> <group head>
//          (the merge queue, RP-398: the group's base is main plus the entries
//          ahead; its head merges the PR's head into it, see mergeGroupSides)

export interface BranchMigration extends Migration {
  /** The migrations in the tree when the branch added this one: what its author could build on. */
  seen: string[];
}

export interface OrderDrift {
  object: string;
  /** The earlier branch migration that defines the object. */
  earlier: string;
  /** The later one, added without seeing the earlier. */
  later: string;
}

export interface Drift {
  object: string;
  branch: string[];
  main: string[];
}

// A table, bare, quoted or schema-qualified (`"public"."notification"`, `public.notification`): `table` is its name.
const tableName = String.raw`(?:"?\w+"?\.)?"?(?<table>\w+)"?`;
// Creating, replacing or dropping an `app` function or view, or a policy.
const definition = new RegExp(
  String.raw`\b(?:create(?:\s+or\s+replace)?|drop)\s+(?:(?<kind>function|view)\s+(?:if\s+exists\s+)?app\."?(?<name>\w+)"?|policy\s+(?:if\s+exists\s+)?"?(?<policy>\w+)"?\s+on\s+${tableName})`,
  "gi",
);
// An `alter table` statement, to its `;` or (one missing its `;`) the next `alter table`, and the constraints its clauses drop or add.
const alterTable = new RegExp(String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${tableName}(?<clauses>(?:(?!\balter\s+table\b)[^;])*)`, "gi");
const constraintClause = /\b(?:drop|add)\s+constraint\s+(?:if\s+exists\s+)?"?(?<constraint>\w+)"?/gi;

/**
 * `sql` without its comments: `--` to the end of the line and `/* … *\/`, but
 * never inside a string literal (`'--'`) or a quoted identifier.
 */
export function withoutComments(sql: string): string {
  let out = "";
  for (let i = 0; i < sql.length; ) {
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
    } else if (two === "/*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
    } else if (sql[i] === "'" || sql[i] === '"') {
      // To the closing quote; a doubled quote ('it''s') is part of the literal.
      const quote = sql[i]!;
      let end = i + 1;
      while (end < sql.length && !(sql[end] === quote && sql[end + 1] !== quote)) end += sql[end] === quote ? 2 : 1;
      out += sql.slice(i, end + 1);
      i = end + 1;
    } else out += sql[i++];
  }
  return out;
}

/**
 * The statements a migration runs as it runs: function bodies (`as $tag$ … $tag$`)
 * emptied, since they run when called, not now (a `do $$ … $$` block runs now, so
 * it stays), and string literals emptied, so a `;` in one ends no statement.
 * Blanked, not cut: every index still points where it did in `code`.
 */
function runNow(code: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  return code
    .replace(/(\bdo\s*)?(\$\w*\$)([\s\S]*?)\2/gi, (whole, isDo: string | undefined, tag: string, body: string) => (isDo ? whole : `${tag}${blank(body)}${tag}`))
    .replace(/'((?:[^']|'')*)'/g, (_, body: string) => `'${blank(body)}'`);
}

/**
 * The objects a migration (re)defines, by kind and name, in the order it first
 * does so; a table constraint dropped or added in an `alter table` counts too
 * (RP-963, why: the header's redefinition drift).
 */
export function definedObjects(sql: string): string[] {
  const code = withoutComments(sql);
  const routines = [...code.matchAll(definition)].map(({ index, groups = {} }) => ({
    index,
    object: groups.kind ? `${groups.kind} app.${groups.name}` : `policy ${groups.policy} on ${groups.table}`,
  }));
  const constraints = [...runNow(code).matchAll(alterTable)].flatMap(({ index, groups = {} }) =>
    [...(groups.clauses ?? "").matchAll(constraintClause)].map((clause) => ({ index: index + clause.index, object: `constraint ${clause.groups?.constraint} on ${groups.table}` })),
  );
  const objects = [...routines, ...constraints].toSorted((a, b) => a.index - b.index).map(({ object }) => object.toLowerCase());
  return [...new Set(objects)];
}

const parsed = new WeakMap<Migration, string[]>();
/** definedObjects of a migration, parsed once. */
function objectsIn(m: Migration): string[] {
  const objects = parsed.get(m) ?? definedObjects(m.sql);
  parsed.set(m, objects);
  return objects;
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
  for (const object of new Set(branch.flatMap(objectsIn))) {
    const defines = (m: Migration) => objectsIn(m).includes(object);
    const onBranch = branch.filter(defines).toSorted((a, b) => (a.name < b.name ? -1 : 1));
    const newest = onBranch.at(-1)!;
    const conflicting = main.filter((m) => defines(m) && (m.name > newest.name || !newest.seen.includes(m.name)));
    if (conflicting.length > 0) drifts.push({ object, branch: onBranch.map((m) => m.name), main: conflicting.map((m) => m.name).toSorted() });
  }
  return drifts;
}

/** The drift check's report of one Drift: the problem, then the fix (planning/parallel-sessions.md rule 11.1). */
export function driftMessage({ object, branch, main }: Drift): [string, string] {
  const fix = object.startsWith("constraint ")
    ? // eslint-disable-next-line rabaed/no-avoid-terms -- a database migration and a Postgres check constraint, not Rabaed terms
      "rebuild it in a new migration that sorts after all of these, with both sides' change: for a check constraint, every value either side allows"
    : // eslint-disable-next-line rabaed/no-avoid-terms -- a database migration, not a data import
      "redefine it in a new migration that sorts after all of these: start from the newest body and re-apply this branch's change";
  return [`${object} is redefined on this branch (${branch.join(", ")}) and on main (${main.join(", ")}).`, `  Merge main, then ${fix} (planning/parallel-sessions.md rule 11.1).`];
}

/**
 * Each object two or more branch migrations define, where one was added without
 * seeing the previous (by name order) that defines it: both started from an older
 * body, so the later one replaces the earlier one's change.
 */
export function branchOrderDrift(branch: BranchMigration[]): OrderDrift[] {
  const drifts: OrderDrift[] = [];
  for (const object of new Set(branch.flatMap(objectsIn))) {
    const onBranch = branch.filter((m) => objectsIn(m).includes(object)).toSorted((a, b) => (a.name < b.name ? -1 : 1));
    for (const [i, later] of onBranch.entries()) {
      const earlier = onBranch[i - 1];
      if (earlier && !later.seen.includes(earlier.name)) drifts.push({ object, earlier: earlier.name, later: later.name });
    }
  }
  return drifts;
}

/** The drift check's report of one OrderDrift: the problem, then the fix; a constraint has no body to start from, so it is rebuilt. */
export function orderMessage({ object, earlier, later }: OrderDrift): [string, string] {
  const how = object.startsWith("constraint ")
    ? // eslint-disable-next-line rabaed/no-avoid-terms -- a Postgres check constraint, not a Rabaed term
      ", that rebuilds it with both migrations' change: for a check constraint, every value either allows."
    : `: start from ${later}'s body and re-apply ${earlier}'s change.`;
  return [
    // eslint-disable-next-line rabaed/no-avoid-terms -- a database migration, not a data import
    `${object} is redefined by ${later} without its seeing ${earlier}, the previous migration on this branch that defines it; the later one replaces the earlier one's change.`,
    // eslint-disable-next-line rabaed/no-avoid-terms -- a database migration, not a data import
    `  Add a new migration that sorts after both, written with both in the tree${how}`,
  ];
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
  const code = withoutComments(sql);
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

/** One file a commit adds or writes, in `head`'s first-parent history; `index` orders them, oldest first. */
interface FileWrite {
  index: number;
  commit: string;
  path: string;
  blob: string;
}

/**
 * The commit that first added each migration on `head`'s first-parent history,
 * by name. A merge's diff is against its first parent, so a migration a merge
 * brings in counts as added there. A migration is judged by the commit that
 * added its file, not by its latest edit (an edit after merging main, even of a
 * comment, doesn't make an old body new), and a rename is followed back by
 * content: the blob the file was added with is traced to the earliest commit
 * that wrote it under any name, and that file to the commit that added it,
 * until that stops moving. Matching content, not `git log --follow`: --follow
 * takes one redefinition of a function for a rename of another.
 */
function firstAdded(repo: string, head: string): (name: string) => { commit: string; name: string } | undefined {
  const log = git(repo, "log", "--first-parent", "--diff-merges=first-parent", "--no-renames", "--diff-filter=AM", "--raw", "--no-abbrev", "--reverse", "--format=commit %H", head, "--", `${migrationsDir}/`);
  const pathAdded = new Map<string, FileWrite>();
  const blobWritten = new Map<string, FileWrite>();
  let commit = "";
  let index = 0;
  for (const line of log.split("\n")) {
    if (line.startsWith("commit ")) commit = line.slice("commit ".length);
    if (!line.startsWith(":")) continue;
    // `:<old mode> <new mode> <old blob> <new blob> <status>\t<path>`
    const [info = "", path = ""] = line.split("\t");
    const [, , , blob = "", status = ""] = info.split(" ");
    const write = { index: index++, commit, path, blob };
    if (status === "A" && !pathAdded.has(path)) pathAdded.set(path, write);
    if (!blobWritten.has(blob)) blobWritten.set(blob, write);
  }
  return (name) => {
    let added = pathAdded.get(`${migrationsDir}/${name}`);
    while (added) {
      const written = blobWritten.get(added.blob);
      const earlier = written && written.index < added.index ? pathAdded.get(written.path) : undefined;
      if (!earlier || earlier.index >= added.index) return { commit: added.commit, name: added.path.slice(`${migrationsDir}/`.length) };
      added = earlier;
    }
    return undefined;
  };
}

/**
 * The commit a migration was written in: the one that first added its file on
 * `head`'s first-parent history (see firstAdded) or, when that is a merge that
 * brought the file in from another parent, the commit that first added it on that
 * parent's own first-parent history, and so on down (RP-457). A merge's tree is
 * not what the author saw: their branch may have merged the integration branch
 * (bringing in another's migration) after writing theirs, and one merge of a
 * sub-integration branch, or an octopus, brings in parallel migrations together.
 */
function writtenIn(repo: string, head: string, name: string, logs: Map<string, ReturnType<typeof firstAdded>>): string {
  if (!logs.has(head)) logs.set(head, firstAdded(repo, head));
  const added = logs.get(head)!(name);
  if (!added) throw new Error(`No commit on ${head}'s first-parent history adds ${name}`);
  const [, , ...others] = git(repo, "rev-list", "--parents", "-n", "1", added.commit).trim().split(" ");
  // A file in no other parent was written in the merge itself (a conflict resolution).
  const from = others.find((parent) => migrationBlobs(repo, parent).has(added.name));
  return from ? writtenIn(repo, from, added.name, logs) : added.commit;
}

/** What the drift check finds: each list empty when there is nothing to fix. */
export interface MigrationProblems {
  drift: Drift[];
  ordering: OrderDrift[];
  overloads: StaleOverload[];
  duplicates: string[][];
}

/** Whether any check found something. */
export const hasProblems = (problems: MigrationProblems): boolean => Object.values(problems).some((found: unknown[]) => found.length > 0);

/**
 * The four checks for a pull request from `head` into `base`. Its migrations
 * are those in `head` and not in `base`; each saw the migrations in the tree of
 * the commit it was written in (writtenIn: the commit that first added its file,
 * following renames back by content and merges down to the branch it was written
 * on; RP-560: renaming a migration after its timestamp clashed, or editing it after
 * merging main, doesn't make an old body new). A migration counts as seen when that
 * tree held it under its name or, renamed since, its content: a branch that
 * rebuilt a function from another branch's migration saw it, even when that
 * branch renamed the file before it merged (PR #180, RP-437), and so for two
 * migrations of the same branch.
 */
export function migrationProblems(repo: string, base: string, head: string): MigrationProblems {
  const baseBlobs = migrationBlobs(repo, base);
  const onBase = [...baseBlobs.keys()];
  const onHead = migrationNames(repo, head);
  const added = onHead.filter((name) => !onBase.includes(name));
  const logs = new Map<string, ReturnType<typeof firstAdded>>();
  const headBlobs = migrationBlobs(repo, head);
  const branch = added.map((name) => {
    const tree = migrationBlobs(repo, writtenIn(repo, head, name, logs));
    const blobs = new Set(tree.values());
    const seenByContent = (names: string[], blobsOf: Map<string, string>) => names.filter((m) => blobs.has(blobsOf.get(m) ?? ""));
    const seen = [...new Set([...tree.keys(), ...seenByContent(added, headBlobs), ...seenByContent(onBase, baseBlobs)])];
    return { name, sql: migrationSql(repo, head, name), seen };
  });
  const main = onBase.map((name) => ({ name, sql: migrationSql(repo, base, name) }));
  return {
    drift: redefinitionDrift(main, branch),
    ordering: branchOrderDrift(branch),
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
  const problems = migrationProblems(process.cwd(), base, head);
  const { drift, ordering, overloads, duplicates } = problems;
  for (const found of drift) for (const line of driftMessage(found)) console.error(line);
  for (const found of ordering) for (const line of orderMessage(found)) console.error(line);
  for (const { signature, branch, main } of overloads) {
    console.error(`${signature} is created on this branch (${branch.join(", ")}) beside another overload; main dropped that signature, or redefined the function out of this branch's sight (${main.join(", ")}).`);
    console.error("  A different argument list makes a second function, so the stale one stays with its old body and grants. Make this branch's change on main's signature instead: rewrite the branch's migration (it isn't on main yet), or drop the stale signature in a new, later migration.");
  }
  for (const group of duplicates) console.error(`These migrations share a timestamp; rename this branch's (it isn't on main yet) to a new, later one: ${group.join(", ")}`);
  // RP-534: run here so CI's "migration drift and timestamps" job and `pnpm check:migrations` both check it.
  const hiddenSorts = reportHiddenSortKeys(process.cwd(), base, head);
  if (hasProblems(problems) || hiddenSorts) process.exit(1);
  console.log("No migration redefined on both sides of a merge, none on the branch redefining another's object unseen, no stale overloads, and no shared timestamps.");
}
