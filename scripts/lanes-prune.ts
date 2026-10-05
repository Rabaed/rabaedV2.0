// Removes the rabaed-* Docker Compose projects old worktrees left behind: those whose
// worktree no longer exists, that are not running, or that only have volumes left.
// Each goes with its containers, volumes (its database) and network. The current
// worktree's project is never removed.
//
//   pnpm lanes:prune [--yes]     --yes skips the confirmation
import { existsSync, readFileSync } from "node:fs";
import { confirmOrExit } from "./confirm.ts";
import { listContainers, listVolumes, removeProject, staleProjects } from "./lanes.ts";

const args = process.argv.slice(2);
if (args.some((a) => a !== "--yes")) {
  console.error("Usage: pnpm lanes:prune [--yes]");
  process.exit(1);
}

const containers = listContainers();
if (!containers) {
  console.error("Docker is not running (or not installed); start it and re-run.");
  process.exit(1);
}
const currentProject = existsSync(".env") ? /^COMPOSE_PROJECT_NAME=(.*)$/m.exec(readFileSync(".env", "utf8"))?.[1]?.trim().replace(/^(["'])(.*)\1$/, "$2") : undefined;
const stale = staleProjects({ containers, volumes: listVolumes(), cwd: process.cwd(), currentProject, exists: existsSync });

if (stale.length === 0) {
  console.log("Nothing to prune.");
  process.exit(0);
}
console.log("Stale compose projects:");
for (const s of stale) {
  console.log(`  ${s.project}: ${s.reason}; containers: ${s.containers.join(", ") || "none"}; volumes: ${s.volumes.join(", ") || "none"}`);
}

await confirmOrExit("Remove them with their volumes? Their databases are lost, including those of stopped worktrees that still exist.", {
  yes: args.includes("--yes"),
  verb: "remove",
  done: "removed",
});

let failed = 0;
for (const s of stale) {
  try {
    removeProject(s);
    console.log(`Removed ${s.project}.`);
  } catch (error) {
    failed++;
    console.error(`Could not remove ${s.project}: ${(error as { stderr?: string }).stderr?.trim() || String(error)}`);
  }
}
if (failed > 0) process.exit(1);
