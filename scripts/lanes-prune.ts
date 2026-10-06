// Removes the rabaed-* Docker Compose projects old worktrees left behind: those whose
// worktree no longer exists, that are not running, or that only have volumes left.
// With --merged, also those whose worktrees' branches are all merged into origin/main
// (as of the last fetch), unless a worktree that is not merged names the project in its .env.
// Each goes with its containers, volumes (its database) and network. The current
// worktree's project is never removed.
//
//   pnpm lanes:prune [--merged] [--yes]     --yes skips the confirmation
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { confirmOrExit } from "./confirm.ts";
import { composeProjectOfEnv, listContainers, listVolumes, mergedProjects, removeProject, staleProjects, type WorktreeLane } from "./lanes.ts";
import { branchMerged, listWorktrees, refExists } from "./worktrees.ts";

const args = process.argv.slice(2);
if (args.some((a) => a !== "--yes" && a !== "--merged")) {
  console.error("Usage: pnpm lanes:prune [--merged] [--yes]");
  process.exit(1);
}
const withMerged = args.includes("--merged");

const containers = listContainers();
if (!containers) {
  console.error("Docker is not running (or not installed); start it and re-run.");
  process.exit(1);
}
const readEnv = (dir: string) => {
  const file = join(dir, ".env");
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
};
const currentProject = composeProjectOfEnv(readEnv(".") ?? "");
const volumes = listVolumes();
const stale = staleProjects({ containers, volumes, cwd: process.cwd(), currentProject, exists: existsSync });

if (withMerged) {
  const all = listWorktrees();
  const mainRoot = all[0]!.path;
  if (!refExists("origin/main", mainRoot)) {
    console.error("origin/main not found: run `git fetch origin main` and re-run.");
    process.exit(1);
  }
  // The main folder, and any worktree on main itself, always keeps its lane.
  const worktrees: WorktreeLane[] = all
    .filter((w) => existsSync(w.path))
    .map((w, i) => ({
      path: w.path,
      branch: w.branch,
      merged: i > 0 && w.branch !== undefined && w.branch !== "main" && branchMerged(w.branch, "origin/main", mainRoot),
      project: composeProjectOfEnv(readEnv(w.path) ?? ""),
    }));
  const known = new Set(stale.map((s) => s.project));
  stale.push(...mergedProjects({ containers, volumes, worktrees, cwd: process.cwd(), currentProject }).filter((m) => !known.has(m.project)));
}

if (stale.length === 0) {
  console.log("Nothing to prune.");
  process.exit(0);
}
console.log("Compose projects to prune:");
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
