import { spawnSync } from "node:child_process";
import { join } from "node:path";

// `pnpm check:migrations` (RP-384): the CI drift check, run before a push or
// PR update. Fetches origin main, then checks origin/main against HEAD, so a
// migration that shares a timestamp with one on main (RP-363's rename, PR #126)
// shows up locally. Offline, the fetch fails: say so and stop.

const options = { cwd: process.cwd(), stdio: "inherit" } as const;
const fetched = spawnSync("git", ["fetch", "origin", "main"], options);
if (fetched.status !== 0) {
  console.error("git fetch origin main failed; the migration check needs a current origin/main.");
  process.exit(fetched.status ?? 1);
}
const checked = spawnSync(process.execPath, [join(import.meta.dirname, "check-migration-drift.ts"), "origin/main", "HEAD"], options);
process.exit(checked.status ?? 1);
