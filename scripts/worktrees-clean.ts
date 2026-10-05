// Removes the merged agent worktrees (.claude/worktrees/agent-*) `/implement-spec`
// leaves behind: those whose branch is merged into the target branch, or whose HEAD
// is detached with no unique commits. Each goes with its leftover folder (node_modules
// included) and its branch. Worktrees with uncommitted changes or unmerged commits are
// never touched; they are listed as skipped.
//
//   pnpm worktrees:clean [--into <branch>] [--yes]     default branch: main; --yes skips the confirmation
import { createInterface } from "node:readline/promises";
import { chooseWorktrees, currentRoot, gatherFacts, gitError, isAgentWorktree, listWorktrees, pruneWorktrees, refExists, removeWorktree } from "./worktrees.ts";

const args = process.argv.slice(2);
let target = "main";
let yes = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  const next = args[i + 1];
  if (a === "--yes") yes = true;
  else if (a === "--into" && next && !next.startsWith("--")) {
    target = next;
    i++;
  } else {
    console.error("Usage: pnpm worktrees:clean [--into <branch>] [--yes]");
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
const { remove, skipped } = chooseWorktrees({ worktrees: agents, currentPath: currentRoot() });

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

if (!yes) {
  if (!process.stdin.isTTY) {
    console.error("Not removed: re-run with --yes to remove them without a prompt.");
    process.exit(1);
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question("Remove them with their folders and branches? [y/N] ");
  prompt.close();
  if (!/^y(es)?$/i.test(answer.trim())) {
    console.log("Nothing removed.");
    process.exit(0);
  }
}

let failed = 0;
for (const w of remove) {
  try {
    removeWorktree(w, mainRoot);
    console.log(`Removed ${w.path}.`);
  } catch (error) {
    failed++;
    console.error(`Could not remove ${w.path}: ${gitError(error)}`);
  }
}
pruneWorktrees(mainRoot);
if (failed > 0) process.exit(1);
