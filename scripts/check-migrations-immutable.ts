import { resolve } from "node:path";
import { git, migrationsDir } from "./migrations.ts";

// A migration that already exists on the base branch is never edited, renamed
// or deleted: databases that ran it would differ from a fresh one. A change goes
// in a new migration; only new files are allowed (RP-287). Nothing is
// exempt: ADR 0006's exception is a new migration, not an edit of an old one.
//
// Usage: node scripts/check-migrations-immutable.ts <base-ref> [head-ref, default HEAD]   (CI: origin/<base branch> on a pull request,
//        the merge group's base SHA in the merge queue (RP-398); needs its history)

/** Changed files under the migrations directory since the merge base, as "<status>\t<path>". A rename counts as a delete plus an add. */
export function changedMigrations(repo: string, base: string, head: string = "HEAD"): { status: string; path: string }[] {
  const diff = git(repo, "diff", "--name-status", "--no-renames", `${base}...${head}`, "--", `${migrationsDir}/`);
  return diff
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status = "", path = ""] = line.split("\t");
      return { status, path };
    });
}

/** The migrations the change edited, renamed or deleted: everything but an added file. */
export function alteredMigrations(repo: string, base: string, head: string = "HEAD"): string[] {
  return changedMigrations(repo, base, head)
    .filter(({ status }) => status !== "A")
    .map(({ status, path }) => `${path} (${status === "D" ? "deleted or renamed" : "edited"})`);
}

/**
 * The migrations the change adds that sort before the base branch's latest
 * migration, each with that latest one. Migrations run in name order, so such a
 * file runs before migrations it was never written against, and a function it
 * re-defines can bring back an outdated copy (RP-311's take_transition, RP-342).
 */
export function misorderedMigrations(repo: string, base: string, head: string = "HEAD"): { path: string; latest: string }[] {
  const names = git(repo, "ls-tree", "--name-only", `${base}:${migrationsDir}`)
    .split("\n")
    .filter((name) => name.endsWith(".sql"));
  const latest = names.reduce((a, b) => (a > b ? a : b), "");
  return changedMigrations(repo, base, head)
    .filter(({ status, path }) => status === "A" && path.slice(path.lastIndexOf("/") + 1) < latest)
    .map(({ path }) => ({ path, latest }));
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  const base = process.argv[2];
  if (!base) {
    console.error("Usage: node scripts/check-migrations-immutable.ts <base-ref> [head-ref]");
    process.exit(2);
  }
  const head = process.argv[3] ?? "HEAD";
  const altered = alteredMigrations(process.cwd(), base, head);
  const misordered = misorderedMigrations(process.cwd(), base, head);
  if (altered.length > 0) {
    console.error("Migrations that already exist on the base branch must not change. Put the change in a new migration:");
    for (const entry of altered) console.error(`  ${entry}`);
  }
  for (const { path, latest } of misordered) {
    console.error(`${path} sorts before ${latest}, the latest migration on the base branch.`);
    console.error("  Merge the base branch, then rename the file to sort after that migration, and re-check every function it re-defines against the base's latest definition: a copy made before the base moved on brings back an outdated body or a stale overload.");
  }
  if (altered.length > 0 || misordered.length > 0) process.exit(1);
  console.log("No existing migration was changed, and every new migration sorts after the base's latest.");
}
