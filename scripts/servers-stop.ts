// Stops the dev servers one worktree started (RP-568): the node processes whose command line
// runs a file under that worktree's node_modules (web, api, admin, Storybook), listed with the
// ports they hold. It never touches another worktree's processes (a nested worktree's files
// count as that worktree's), never Docker, and never this command's own process tree.
//
//   pnpm servers:stop [--worktree <path>] [--yes] [--dry-run]
//
// --worktree defaults to the current worktree and must be a worktree of this clone; --yes
// skips the prompt; --dry-run only lists and exits 0. One plain command, so the permission
// check can allow it (planning/parallel-sessions.md, Implementer brief).
import { resolve } from "node:path";
import { confirmOrExit } from "./confirm.ts";
import { samePath } from "./paths.ts";
import { describeServer, findServers, firstLine, stopServers } from "./servers.ts";
import { currentRoot, listWorktrees } from "./worktrees.ts";

const usage = "Usage: pnpm servers:stop [--worktree <path>] [--yes] [--dry-run]";
const args = process.argv.slice(2);
let worktree: string | undefined;
let yes = false;
let dryRun = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  const next = args[i + 1];
  if (a === "--yes") yes = true;
  else if (a === "--dry-run") dryRun = true;
  else if (a === "--worktree" && next && !next.startsWith("--")) {
    worktree = next;
    i++;
  } else {
    console.error(usage);
    process.exit(1);
  }
}

const worktrees = listWorktrees().map((w) => w.path);
const target = worktree === undefined ? currentRoot() : worktrees.find((w) => samePath(w, resolve(worktree!)));
if (target === undefined) {
  console.error(`${worktree} is not a worktree of this clone (git worktree list).`);
  process.exit(1);
}

let servers;
try {
  servers = findServers(target, worktrees);
} catch (error) {
  console.error(`Could not read the running processes (${firstLine(error)}).`);
  process.exit(1);
}
if (servers.length === 0) {
  console.log(`No dev servers run from ${target}.`);
  process.exit(0);
}
console.log(`Dev servers running from ${target}:`);
for (const s of servers) console.log(`  ${describeServer(s)}`);
if (dryRun) {
  console.log("Dry run: nothing stopped.");
  process.exit(0);
}

await confirmOrExit("Stop them?", { yes, verb: "stop", done: "stopped" });

const failed = stopServers(servers);
for (const s of servers) if (!failed.some((f) => f.server.pid === s.pid)) console.log(`Stopped pid ${s.pid}.`);
for (const { server, reason } of failed) console.error(`Could not stop pid ${server.pid}: ${reason}`);
if (failed.length > 0) process.exit(1);
