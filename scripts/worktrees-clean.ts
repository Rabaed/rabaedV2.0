// Removes the merged agent worktrees (.claude/worktrees/agent-*) `/implement-spec`
// leaves behind: those whose branch is merged into the target branch, or whose HEAD
// is detached with no unique commits. Each goes with its leftover folder (node_modules
// included) and its branch (`git branch -D` when the branch is an ancestor of the
// target, whichever branch the main folder has checked out; otherwise it is kept and
// named), plus the `worktree-agent-*` branch the app created it on. Worktrees with
// uncommitted changes or unmerged commits are never touched, nor, without
// --include-empty, those whose branch has no commit of its own yet: their subagent
// may still be running. They are listed as skipped.
//
//   pnpm worktrees:clean [--into <branch>] [--include-empty] [--yes]
//
// The default branch is main; --yes skips the confirmation.
import { confirmOrExit } from "./confirm.ts";
import { chooseWorktrees, currentRoot, gatherFacts, gitError, isAgentWorktree, listWorktrees, pruneWorktrees, refExists, removeWorktree, reportRemoval } from "./worktrees.ts";

const usage = "Usage: pnpm worktrees:clean [--into <branch>] [--include-empty] [--yes]";
const args = process.argv.slice(2);
let target = "main";
let yes = false;
let includeEmpty = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  const next = args[i + 1];
  if (a === "--yes") yes = true;
  else if (a === "--include-empty") includeEmpty = true;
  else if (a === "--into" && next && !next.startsWith("--")) {
    target = next;
    i++;
  } else {
    console.error(usage);
    process.exit(1);
  }
}

const all = listWorktrees();
const mainRoot = all[0]!.path;
if (!refExists(target, mainRoot)) {
  console.error(`Branch ${target} not found; pass an existing branch with --into.`);
  process.exit(1);
}
const agents = gatherFacts(
  all.filter((w) => isAgentWorktree(w.path, mainRoot)),
  target,
  mainRoot,
);
const { remove, skipped } = chooseWorktrees({ worktrees: agents, currentPath: currentRoot(), includeEmpty });

const name = (w: { path: string; branch: string | undefined }) => `${w.path} (${w.branch ?? "detached HEAD"})`;
if (skipped.length > 0) {
  console.log("Skipped:");
  for (const s of skipped) console.log(`  ${name(s.worktree)}: ${s.reason}`);
}
if (remove.length === 0) {
  console.log(`No agent worktrees merged into ${target} to remove.`);
  process.exit(0);
}
console.log(`Agent worktrees merged into ${target}:`);
for (const w of remove) console.log(`  ${name(w)}`);

await confirmOrExit("Remove them with their folders and branches?", { yes, verb: "remove", done: "removed" });

let failed = 0;
for (const w of remove) {
  try {
    if (reportRemoval(w.path, removeWorktree(w, mainRoot, target))) failed++;
  } catch (error) {
    failed++;
    console.error(`Could not remove ${w.path}: ${gitError(error)}`);
  }
}
try {
  pruneWorktrees(mainRoot);
} catch (error) {
  failed++;
  console.error(`git worktree prune failed: ${gitError(error)}`);
}
if (failed > 0) process.exit(1);
