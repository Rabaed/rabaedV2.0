import { spawnSync } from "node:child_process";
import { reportMigrationProblems } from "./check-migration-drift.ts";
import { branchIssue, formatReservation, migrationDays, reservationsFile } from "./check-migrations-days.ts";
import { reportImmutable } from "./check-migrations-immutable.ts";
import { verdictLine } from "./check-migrations-verdict.ts";
import { git } from "./migrations.ts";

// `pnpm check:migrations` (RP-384): the CI drift check, run before a push or
// PR update. Fetches origin main, then checks origin/main against HEAD, so a
// migration that shares a timestamp with one on main (RP-363's rename, PR #126)
// shows up locally (the drift check also reports a new migration that sorts by
// a hidden column, RP-534). Offline, the fetch fails: say so and stop.
// Then scripts/check-migrations-immutable.ts (RP-977), the same check CI runs: an
// existing migration edited or deleted, or a new one that sorts before main's newest,
// fails here with its own message, not only in CI after the push.
// Then the migration days (RP-560): a migration on a day planning/migration-days.md
// reserves for another issue is refused; one on a day nobody reserved is named.
// Last, one verdict line with each kind of refusal and its count (RP-990), so any
// tail of the output shows the outcome.

const repo = process.cwd();
const fetched = spawnSync("git", ["fetch", "origin", "main"], { cwd: repo, stdio: "inherit" });
if (fetched.status !== 0) {
  console.error("git fetch origin main failed; the migration check needs a current origin/main.");
  console.log("check:migrations: FAILED (git fetch origin main failed)");
  process.exit(fetched.status ?? 1);
}
const { drift, ordering, overloads, duplicates, hiddenSorts } = reportMigrationProblems(repo, "origin/main", "HEAD");

const { altered, misordered } = reportImmutable(repo, "origin/main", "HEAD");

const branch = git(repo, "rev-parse", "--abbrev-ref", "HEAD").trim();
const { refused, unreserved } = migrationDays(repo, "origin/main", "HEAD", branchIssue(branch));
for (const { name, reservation } of refused) {
  console.error(`${name} is on a day ${reservationsFile} reserves for another issue: ${formatReservation(reservation)}`);
  console.error("  Move it to a day reserved for this issue (its branch name or its header names the issue), or ask the planning session for one.");
}
if (unreserved.length > 0) console.error(`Warning: no day in ${reservationsFile} is reserved for ${unreserved.join(", ")}. Create migrations with \`pnpm migration:new <name> --issue RP-nnn\`: it takes the next free day and reserves it, so another lane doesn't take it.`);
if (refused.length === 0) console.log("Every new migration is on a day reserved for its issue, or on an unreserved one.");

const refusals = {
  redefinedOnMain: drift.length,
  redefinedUnseen: ordering.length,
  staleOverloads: overloads.length,
  sharedTimestamps: duplicates.length,
  hiddenSortKeys: hiddenSorts.length,
  existingChanged: altered.length,
  sortBeforeMain: misordered.length,
  otherIssueDays: refused.length,
};
console.log(verdictLine(refusals, unreserved.length));
if (Object.values(refusals).some((count) => count > 0)) process.exit(1);
