import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { branchIssue, formatReservation, migrationDays, reservationsFile } from "./check-migrations-days.ts";
import { git } from "./migrations.ts";

// `pnpm check:migrations` (RP-384): the CI drift check, run before a push or
// PR update. Fetches origin main, then checks origin/main against HEAD, so a
// migration that shares a timestamp with one on main (RP-363's rename, PR #126)
// shows up locally (the drift check also reports a new migration that sorts by
// a hidden column, RP-534). Offline, the fetch fails: say so and stop.
// Then scripts/check-migrations-immutable.ts (RP-977), the same check CI runs.
// Then the migration days (RP-560): a migration on a day planning/migration-days.md
// reserves for another issue is refused; one on a day nobody reserved is named.

const repo = process.cwd();
const options = { cwd: repo, stdio: "inherit" } as const;
const fetched = spawnSync("git", ["fetch", "origin", "main"], options);
if (fetched.status !== 0) {
  console.error("git fetch origin main failed; the migration check needs a current origin/main.");
  process.exit(fetched.status ?? 1);
}
const checked = spawnSync(process.execPath, [join(import.meta.dirname, "check-migration-drift.ts"), "origin/main", "HEAD"], options);

// Then CI's immutable check (RP-977): a migration that sorts before main's newest
// (or an existing one edited or deleted) fails here with its own message, not
// only in CI after the push.
const ordered = spawnSync(process.execPath, [join(import.meta.dirname, "check-migrations-immutable.ts"), "origin/main"], options);

const branch = git(repo, "rev-parse", "--abbrev-ref", "HEAD").trim();
const { refused, unreserved } = migrationDays(repo, "origin/main", "HEAD", branchIssue(branch));
for (const { name, reservation } of refused) {
  console.error(`${name} is on a day ${reservationsFile} reserves for another issue: ${formatReservation(reservation)}`);
  console.error("  Move it to a day reserved for this issue (its branch name or its header names the issue), or ask the planning session for one.");
}
if (unreserved.length > 0) console.error(`Warning: no day in ${reservationsFile} is reserved for ${unreserved.join(", ")}. Create migrations with \`pnpm migration:new <name> --issue RP-nnn\`: it takes the next free day and reserves it, so another lane doesn't take it.`);
if (refused.length === 0) console.log("Every new migration is on a day reserved for its issue, or on an unreserved one.");

if (checked.status !== 0) process.exit(checked.status ?? 1);
if (ordered.status !== 0) process.exit(ordered.status ?? 1);
if (refused.length > 0) process.exit(1);
