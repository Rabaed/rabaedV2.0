// Removes one worktree whose `git worktree remove` fails on Windows (RP-1101): "Filename too long",
// or "Function not implemented" after git already deleted its .git. With core.longpaths, then
// `rd /s /q \\?\` and the path for what is left, then `git worktree prune` (worktree-removal.ts).
// It refuses the main checkout, the current worktree, a folder a Claude session works in, and
// lane 7's (Main 7's harness data), always; a folder git does not list outside .claude/worktrees/;
// and, without --force, one with uncommitted or untracked files (listed) or unpushed commits
// (merges of origin/main only do not count, RP-1198). Outside .claude/worktrees/ it deletes no folder: only
// `git worktree remove` without --force, so git keeps one with changes (RP-1198, removal-guard.ts).
// Its branch and its compose project stay: it says how to remove them.
//
//   pnpm worktree:remove "path" [--force]      (until its package.json line lands: node scripts/worktree-remove.ts)
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { holdReason, systemHolders } from "./claude-sessions.ts";
import { freeableLane, laneOfProject, projectOfFolder } from "./lanes.ts";
import { samePath } from "./paths.ts";
import { removalRefusal, removeWorktreeFolder, type RemoveTarget } from "./worktree-removal.ts";
import { currentRoot, gitChanges, listWorktrees, unlessMergesOnly, unpushedCount } from "./worktrees.ts";

const args = process.argv.slice(2);
const force = args.includes("--force");
const paths = args.filter((a) => a !== "--force");
if (paths.length !== 1 || paths[0]!.startsWith("--")) {
  // RP-1198: no `<…>`, which PowerShell reads as a redirect when the line is copied.
  console.error('Usage: pnpm worktree:remove "path of the worktree" [--force]');
  process.exit(1);
}
const path = resolve(paths[0]!);
const worktrees = listWorktrees();
const mainRoot = worktrees[0]!.path;
const registered = worktrees.find((w) => samePath(w.path, path));
const exists = existsSync(path);
/** git reads the worktree only while its .git is there. */
const readable = exists && existsSync(join(path, ".git"));
const attempt = <T>(read: () => T): T | undefined => {
  try {
    return read();
  } catch {
    return undefined;
  }
};

const target: RemoveTarget = {
  path: registered?.path ?? path,
  mainRoot,
  currentRoot: currentRoot(),
  registered,
  exists,
  readable,
  changes: readable ? attempt(() => gitChanges(path)) : undefined,
  // RP-1198: merges of origin/main only are not unpushed work, so a branch that only merged main in needs no --force.
  unpushed: readable && registered ? attempt(() => unlessMergesOnly(unpushedCount(registered.head, mainRoot), registered.head, mainRoot)) : undefined,
  project: exists ? projectOfFolder(path) : undefined,
  held: holdReason(path, systemHolders()),
};
const refused = removalRefusal(target, { force });
if (refused !== undefined) {
  console.error(refused);
  process.exit(1);
}

// From the main folder: never from inside the folder being removed.
const run = (command: string, commandArgs: string[]) => execFileSync(command, commandArgs, { cwd: mainRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
// RP-1198: removeWorktreeFolder refuses on its own too (the main checkout, lane 7's, a folder git does not list outside .claude/worktrees).
const removal = removeWorktreeFolder(target, { run, exists: existsSync });
if ("refused" in removal) {
  console.error(removal.refused);
  process.exit(1);
}
const { removed, steps } = removal;
for (const line of steps) console.log(line);
if (registered?.branch) console.log(`Branch ${registered.branch} kept: \`git branch -D ${registered.branch}\` once it is merged.`);
if (target.project) {
  // RP-1198: the real lane, never a placeholder; lane 7's (never freed) and a non-lane project get no command.
  const lane = laneOfProject(target.project);
  const free = freeableLane(lane) ? `\`pnpm lanes:prune --lane ${lane}\` frees it` : "`pnpm lanes:prune --stale` lists it";
  console.log(`Compose project ${target.project} kept: ${free}.`);
}
if (!removed) {
  console.error(`${target.path} is still there: close what holds files in it (an editor, a dev server) and run this again.`);
  process.exit(1);
}
console.log(`Removed ${target.path}.`);
