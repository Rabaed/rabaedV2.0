import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// A migration that already exists on the base branch is never edited, renamed
// or deleted: databases that ran it would differ from a fresh one. A change goes
// in a new migration; only new files are allowed (RP-287). ADR 0006's exception
// is a published Form Version changed through a new migration, so nothing is
// exempt.
//
// Usage: node scripts/check-migrations-immutable.ts <base-ref>   (CI: origin/<base branch>; needs its history)

const migrationsDir = "packages/db/migrations/";

/** Changed files under the migrations directory since the merge base, as "<status>\t<path>". A rename counts as a delete plus an add. */
export function changedMigrations(repo: string, base: string): { status: string; path: string }[] {
  const diff = execFileSync("git", ["diff", "--name-status", "--no-renames", `${base}...HEAD`, "--", migrationsDir], { cwd: repo, encoding: "utf8" });
  return diff
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status = "", path = ""] = line.split("\t");
      return { status, path };
    });
}

/** The migrations the change edited, renamed or deleted: everything but an added file. */
export function alteredMigrations(repo: string, base: string): string[] {
  return changedMigrations(repo, base)
    .filter(({ status }) => status !== "A")
    .map(({ status, path }) => `${path} (${status === "D" ? "deleted or renamed" : "edited"})`);
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  const base = process.argv[2];
  if (!base) {
    console.error("Usage: node scripts/check-migrations-immutable.ts <base-ref>");
    process.exit(2);
  }
  const altered = alteredMigrations(process.cwd(), base);
  if (altered.length > 0) {
    console.error("Migrations that already exist on the base branch must not change. Put the change in a new migration:");
    for (const entry of altered) console.error(`  ${entry}`);
    process.exit(1);
  }
  console.log("No existing migration was changed.");
}
