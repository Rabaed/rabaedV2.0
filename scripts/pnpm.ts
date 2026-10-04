import { spawnSync } from "node:child_process";
import { basename } from "node:path";

// Runs pnpm with the given arguments, for root package.json scripts that call
// another pnpm command (`pnpm -r run typecheck`, `pnpm --filter … run setup`).
//
// A bare `pnpm` in a script needs pnpm on PATH, which agent shells don't have:
// they only have `corepack pnpm`, and the nested call failed with "'pnpm' is not
// recognized" (RP-298). pnpm puts its own entry file in npm_execpath for every
// script it runs, so rerunning that file with node reaches the same pnpm,
// however it was started.
//
// Usage (in package.json): node scripts/pnpm.ts <pnpm arguments>

const args = process.argv.slice(2);
const entry = process.env.npm_execpath;

const result =
  entry && basename(entry).startsWith("pnpm")
    ? spawnSync(process.execPath, [entry, ...args], { stdio: "inherit" })
    : // Not started by pnpm (e.g. run by hand): use pnpm from PATH.
      spawnSync("pnpm", args, { stdio: "inherit", shell: process.platform === "win32" });

if (result.error) {
  console.error(`Could not run pnpm: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
