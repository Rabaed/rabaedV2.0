// Removes the rabaed-* Docker Compose projects old worktrees left behind: those whose
// worktree no longer exists, that are not running, or that only have volumes left.
// Each goes with its containers, volumes (its database) and network. The current
// worktree's project is never removed.
//
//   pnpm lanes:prune [--yes]     --yes skips the confirmation
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
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
const currentProject = existsSync(".env") ? /^COMPOSE_PROJECT_NAME=(.*)$/m.exec(readFileSync(".env", "utf8"))?.[1]?.trim() : undefined;
const stale = staleProjects({ containers, volumes: listVolumes(), cwd: process.cwd(), currentProject, exists: existsSync });

if (stale.length === 0) {
  console.log("Nothing to prune.");
  process.exit(0);
}
console.log("Stale compose projects:");
for (const s of stale) {
  console.log(`  ${s.project}: ${s.reason}; containers: ${s.containers.join(", ") || "none"}; volumes: ${s.volumes.join(", ") || "none"}`);
}

if (!args.includes("--yes")) {
  if (!process.stdin.isTTY) {
    console.error("Not removed: re-run with --yes to remove them without a prompt.");
    process.exit(1);
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question("Remove them with their volumes (their databases are lost)? [y/N] ");
  prompt.close();
  if (!/^y(es)?$/i.test(answer.trim())) {
    console.log("Nothing removed.");
    process.exit(0);
  }
}

for (const s of stale) {
  removeProject(s);
  console.log(`Removed ${s.project}.`);
}
