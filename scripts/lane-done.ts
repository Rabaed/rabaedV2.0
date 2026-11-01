// `pnpm lane:done <pr>` (RP-1170): the whole clean-up of a finished lane in one command, run from
// another worktree (the Main's or the Orchestrator's) once the PR has merged and its session is archived.
//   1. Checks the PR merged, before anything else (gh pr view); then refuses a shallow clone, fetches
//      origin (`git fetch --prune origin`) and checks the PR's head is in origin/main.
//   2. Finds the lane's worktree (on the PR's branch, or a detached HEAD at its head) and the subagent
//      worktrees (.claude/worktrees/agent-*) whose .env names the lane, and judges each
//      (lane-done-plan.ts: the safety rules are there, with their tests). Every one kept is listed at once.
//   3. Removes each, only under .claude/worktrees/ and only past `pnpm worktree:remove`'s own refusals
//      (worktree-removal.ts removalRefusal), with its long-path steps (core.longpaths, `rd /s /q \\?\…`,
//      `git worktree prune`), then its branch: the lane's when its tip is in origin/main; a subagent's when
//      every file it changed matches origin/main (a cherry-picked result: its commits are not in main);
//      the app's worktree-agent-* branch only when its tip is in origin/main.
//   4. Removes the lane's stack (containers, volumes, network; lanes.ts removeProject), never lane 7's and
//      never one another worktree's .env or a live session uses, checked again just before; while a
//      verify runs anywhere on the machine its volumes stay (verifies-running.ts).
//   5. Prints the RP-603 RELEASE text as its last line. It never posts to Jira itself.
//
//   pnpm lane:done <pr> [--lane N] [--force] [--yes] [--dry-run]
//     --lane N   the lane, when the PR's worktree is gone (or to check it is the one its .env names); never 7
//     --force    removes worktrees with uncommitted or untracked files, or commits origin/main lacks
//     --yes      skips the confirmation; --dry-run only lists, and removes nothing
// RP-1198: after its arguments, before anything else, it stops when this checkout is too far behind origin/main (behind-origin.ts).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { holdReason, systemHolders } from "./claude-sessions.ts";
import { stopIfBehindOrigin } from "./behind-origin.ts";
import { confirmOrExit } from "./confirm.ts";
import { aheadOf, branchPaths } from "./lane-done-git.ts";
import { branchKey } from "./lane-claims.ts";
import { describeWorktree, notMergedRefusal, parseLaneDoneArgs, decideLaneDone, releaseLines, type Candidate, type PullRequest } from "./lane-done-plan.ts";
import {
  claimOf,
  composeProjectOfEnv,
  envClaims,
  laneOfProject,
  laneProject,
  listContainers,
  listVolumes,
  projectInUseNow,
  readProjectNow,
  readWorktreeEnv,
  removeProject,
  type Volume,
} from "./lanes.ts";
import { samePath } from "./paths.ts";
import { keptLast, shallowRefusal } from "./prune-guards.ts";
import { verifiesRunningNow, volumesKeptReason } from "./verifies-running.ts";
import { DOCKER_TIMEOUT_MS } from "./verify-health.ts";
import { removalRefusal, removeWorktreeFolder, type RemoveTarget } from "./worktree-removal.ts";
import { isAppWorktree } from "./worktrees-pruning.ts";
import { currentRoot, fetchPrune, gitChanges, gitError, isAgentWorktree, isAncestor, isShallowRepo, listWorktrees, refExists, systemLiveness, unpushedCount, type Worktree } from "./worktrees.ts";

const TARGET = "origin/main";
const parsed = parseLaneDoneArgs(process.argv.slice(2));
if ("error" in parsed) {
  console.error(parsed.error);
  process.exit(1);
}
const { force, yes, dryRun } = parsed;
stopIfBehindOrigin("pnpm lane:done");

// Rule 8: the PR first.
const pr = readPullRequest(parsed.pr);
const notMerged = notMergedRefusal(pr);
if (notMerged !== undefined) {
  console.error(notMerged);
  process.exit(1);
}

const mainRoot = listWorktrees()[0]!.path;
const git = (args: string[]) => execFileSync("git", args, { cwd: mainRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const stop = (why: string): never => {
  console.error(`lane:done refused: ${why}. Nothing was touched.`);
  process.exit(1);
};
const shallow = shallowRefusal(isShallowRepo(mainRoot), "lane:done");
if (shallow !== undefined) {
  console.error(shallow);
  process.exit(1);
}
try {
  fetchPrune(mainRoot);
} catch (error) {
  stop(`\`git fetch --prune origin\` failed (${gitError(error)}), so "merged" cannot be judged`);
}
if (!refExists(TARGET, mainRoot)) stop(`${TARGET} not found`);
if (!isAncestor(pr.headRefOid, TARGET, mainRoot)) stop(`PR #${pr.number}'s head ${pr.headRefOid.slice(0, 9)} is not in ${TARGET} after the fetch`);

const here = currentRoot();
const live = systemLiveness();
const worktrees = listWorktrees(mainRoot);
const projectOf = (path: string) => (existsSync(path) ? composeProjectOfEnv(readWorktreeEnv(path) ?? "") : undefined);
const onPrBranch = (w: Worktree) => w.branch === pr.headRefName || (w.branch === undefined && w.head === pr.headRefOid);
const lanes = worktrees.filter(onPrBranch);
const laneNumber = parsed.lane ?? lanes.map((w) => laneOfProject(projectOf(w.path) ?? "")).find((n) => n !== undefined);
const agents = laneNumber === undefined ? [] : worktrees.filter((w) => !onPrBranch(w) && isAgentWorktree(w.path, mainRoot) && projectOf(w.path) === laneProject(laneNumber));
// A subagent worktree whose .env names no lane cannot be told apart from another lane's: named, left to worktrees:clean.
const unattributed = worktrees.filter((w) => isAgentWorktree(w.path, mainRoot) && existsSync(w.path) && projectOf(w.path) === undefined).length;
const candidates: Candidate[] = [...lanes.map((w) => facts(w, "lane")), ...agents.map((w) => facts(w, "agent"))];
const isCandidate = (path: string) => candidates.some((c) => samePath(c.path, path));
const claims = envClaims(
  worktrees.filter((w) => existsSync(w.path) && !isCandidate(w.path)),
  { cwd: here, readEnv: readWorktreeEnv },
);

const containers = listContainers(DOCKER_TIMEOUT_MS);
let volumes: Volume[] | undefined;
try {
  volumes = containers && listVolumes(DOCKER_TIMEOUT_MS);
} catch {
  volumes = undefined;
}
const dockerAnswers = containers !== undefined && volumes !== undefined;
const volumesKeptBecause = volumesKeptReason(verifiesRunningNow(mainRoot));
const decision = decideLaneDone({
  pr,
  lane: parsed.lane,
  candidates,
  claims,
  containers: containers ?? [],
  volumes: volumes ?? [],
  currentProject: projectOf(here),
  volumesKeptBecause,
  force,
  exists: existsSync,
});
if (decision.refusal !== undefined) {
  console.error(decision.refusal);
  process.exit(1);
}
const stack = dockerAnswers ? decision.stack : undefined;
const kept = [...decision.kept];
const logged: string[] = [];
if (!dockerAnswers && decision.stack !== undefined) logged.push(`${decision.stack.project}: Docker did not answer in ${DOCKER_TIMEOUT_MS / 1000} s, so the stack was not checked; free it later with \`pnpm lanes:prune --lane ${laneNumber}\`.`);
if (stack?.action === "keep") kept.push({ what: `stack ${stack.project}`, reason: stack.why.join("; ") });

for (const line of decision.remarks) console.log(line);
if (unattributed > 0) {
  console.log(`${unattributed} subagent worktree${unattributed === 1 ? " has" : "s have"} no lane in .env, so lane:done cannot tell whose they are: \`pnpm worktrees:clean --into main --yes\` removes the merged ones.`);
}
if (decision.remove.length > 0) {
  console.log(`Worktrees of PR #${pr.number} to remove, with their folders and branches:`);
  for (const c of decision.remove) console.log(`  ${describeWorktree(c)}${c.kind === "agent" ? " (subagent)" : ""}`);
}
if (stack !== undefined && (stack.action === "remove" || stack.action === "containers")) {
  const what = stack.action === "remove" ? `containers ${stack.containers.join(", ") || "none"}; volumes ${stack.volumes.join(", ") || "none"}` : `containers ${stack.containers.join(", ") || "none"}; ${stack.why.join("; ")}`;
  console.log(`Stack to remove: ${stack.project} (${what}).`);
} else if (stack?.action === "none") console.log(`Stack ${stack.project}: nothing of it is left.`);
const printKept = () => {
  for (const line of keptLast(kept, logged)) console.log(line);
};
const release = releaseLines({ pr, lane: laneNumber, openSiblings: openSiblings() });
const printRelease = () => {
  for (const line of release) console.log(line);
};
const stackGoes = stack?.action === "remove" || stack?.action === "containers";
if (decision.remove.length === 0 && !stackGoes) {
  console.log("Nothing to remove.");
  printKept();
  printRelease();
  process.exit(kept.length + logged.length > 0 ? 1 : 0);
}
printKept();
if (dryRun) {
  console.log("Dry run: nothing removed.");
  printRelease();
  process.exit(0);
}
await confirmOrExit(stack?.action === "remove" ? "Remove them, the stack's volumes (its database) included?" : "Remove them?", { yes, verb: "remove", done: "removed" });

let failed = 0;
const removedPaths: string[] = [];
for (const c of decision.remove) {
  // Read again just before: a session may have moved in, or files changed, since the listing.
  const registered = worktrees.find((w) => samePath(w.path, c.path));
  const exists = existsSync(c.path);
  const readable = exists && existsSync(join(c.path, ".git"));
  const target: RemoveTarget = {
    path: c.path,
    mainRoot,
    currentRoot: here,
    registered,
    exists,
    readable,
    changes: readable ? attempt(() => gitChanges(c.path)) : undefined,
    // Rule 3 found every change of a subagent's branch in origin/main, so its commits, never pushed, lose nothing.
    unpushed: c.kind === "agent" ? 0 : readable && registered ? attempt(() => unpushedCount(registered.head, mainRoot)) : undefined,
    project: exists ? projectOf(c.path) : c.project,
    held: holdReason(c.path, systemHolders(), { sinceListed: true }),
  };
  // `pnpm worktree:remove`'s own refusals, last: never the main checkout, the current worktree, a held one,
  // lane 7's or one outside .claude/worktrees; without --force, none with changes or unpushed commits.
  const refused = !isAppWorktree(c.path, mainRoot) ? `Not removed: ${c.path} is not under .claude/worktrees.` : removalRefusal(target, { force });
  if (refused !== undefined) {
    kept.push({ what: describeWorktree(c), reason: refused.replace(/^Not removed: /, "") });
    continue;
  }
  const { removed, steps } = removeWorktreeFolder(target, { run: (command, args) => execFileSync(command, args, { cwd: mainRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), exists: existsSync });
  if (!removed) {
    failed++;
    console.error(`Could not remove ${c.path}: ${steps.join("; ")}. Close what holds files in it (an editor, a dev server) and run this again.`);
    continue;
  }
  removedPaths.push(c.path);
  console.log(`Removed ${c.path}.`);
  deleteBranches(c);
}

if (stack !== undefined && stackGoes) {
  const stays = decision.remove.some((c) => c.project === stack.project && !removedPaths.some((p) => samePath(p, c.path)));
  // RP-1073: judged again just before; the worktrees just removed no longer count.
  const inUse = stays
    ? "a worktree whose .env has it was not removed"
    : projectInUseNow(stack.project, {
        listedClaims: [...claims, ...candidates.flatMap((c) => claimOf(c, c.project))],
        listedContainers: containers ?? [],
        now: readProjectNow(stack.project, { worktrees: listWorktrees(mainRoot), cwd: here }),
        exists: (dir) => existsSync(dir) && !removedPaths.some((p) => samePath(p, dir)),
      });
  if (inUse !== undefined) kept.push({ what: `stack ${stack.project}`, reason: inUse });
  else {
    try {
      // removeProject reads the verifies again just before (rule 4).
      const { volumesKept } = removeProject(
        { project: stack.project, reason: `PR #${pr.number} merged`, containers: stack.containers, volumes: stack.volumes },
        { keepVolumes: stack.action === "containers", volumesKeptBecause: () => volumesKeptReason(verifiesRunningNow(mainRoot)) },
      );
      if (volumesKept !== undefined) {
        console.log(`Removed ${stack.project}'s containers and network; its volumes stay.`);
        logged.push(`${stack.project}'s volumes: ${volumesKeptBecause ?? volumesKept}; \`pnpm lanes:prune --lane ${laneNumber}\` removes them once no verify runs.`);
      } else console.log(`Removed ${stack.project} with its volumes.`);
    } catch (error) {
      failed++;
      console.error(`Could not remove ${stack.project}: ${(error as Error).message}`);
    }
  }
}

printKept();
printRelease();
process.exit(failed > 0 || kept.length + logged.length > 0 ? 1 : 0);

function attempt<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/** The facts lane-done-plan.ts judges a worktree on; whatever git cannot tell is undefined, which keeps it. */
function facts(w: Worktree, kind: Candidate["kind"]): Candidate {
  const exists = existsSync(w.path);
  const readable = exists && existsSync(join(w.path, ".git"));
  const ahead = attempt(() => aheadOf(w.head, TARGET, mainRoot));
  const paths = kind === "agent" ? attempt(() => branchPaths(w.head, TARGET, mainRoot)) : undefined;
  return {
    path: w.path,
    branch: w.branch,
    head: w.head.slice(0, 9),
    kind,
    exists,
    isMain: samePath(w.path, mainRoot),
    isCurrent: samePath(w.path, here),
    appWorktree: isAppWorktree(w.path, mainRoot),
    held: holdReason(w.path, live.holders),
    heldByProcess: exists && live.heldByProcess(w.path),
    lockLive: live.lockLive(w.locked),
    locked: w.locked,
    ownChanges: paths?.changed.length,
    changes: !exists ? [] : readable ? attempt(() => gitChanges(w.path)) : undefined,
    project: projectOf(w.path),
    onPr: pr.commits.includes(w.head) || isAncestor(pr.headRefOid, w.head, mainRoot),
    ahead: Number.isInteger(ahead) ? ahead : undefined,
    filesNotInMain: paths?.notInTarget,
  };
}

/** The removed worktree's branches: the lane's and the app's worktree-agent-* one when the tip is in origin/main; a subagent's when every file it changed matches origin/main, though its commits are not there. */
function deleteBranches(c: Candidate): void {
  const branches = c.branch === undefined ? [] : [c.branch];
  const created = `worktree-${c.path.replace(/[\\/]+$/, "").split(/[\\/]/).pop()}`;
  if (c.kind === "agent" && created !== c.branch && refExists(`refs/heads/${created}`, mainRoot)) branches.push(created);
  for (const branch of branches) {
    const merged = isAncestor(`refs/heads/${branch}`, TARGET, mainRoot);
    if (!merged && !(c.kind === "agent" && branch === c.branch)) {
      logged.push(`Branch ${branch} kept: it has commits ${TARGET} does not.`);
      continue;
    }
    try {
      git(["branch", "-D", branch]);
      console.log(`  Removed branch ${branch}.`);
    } catch (error) {
      logged.push(`Branch ${branch} kept: ${gitError(error)}`);
    }
  }
}

/** `gh pr view`, as lane-done-plan.ts reads it; exits when gh cannot tell. */
function readPullRequest(number: number): PullRequest {
  let out: string;
  try {
    out = execFileSync("gh", ["pr", "view", String(number), "--json", "number,state,mergedAt,headRefName,headRefOid,mergeCommit,commits"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    console.error(`lane:done refused: \`gh pr view ${number}\` failed (${gitError(error)}). Nothing was touched.`);
    process.exit(1);
  }
  const raw = JSON.parse(out) as { number: number; state: string; mergedAt: string | null; headRefName: string; headRefOid: string; mergeCommit: { oid: string } | null; commits: { oid: string }[] };
  return { number: raw.number, state: raw.state, mergedAt: raw.mergedAt ?? undefined, headRefName: raw.headRefName, headRefOid: raw.headRefOid, mergeCommit: raw.mergeCommit?.oid, commits: raw.commits.map((c) => c.oid) };
}

/** The other open PRs whose branch starts with the same key; none when gh cannot tell. */
function openSiblings(): number[] {
  const key = branchKey(pr.headRefName);
  if (key === undefined) return [];
  try {
    const open = JSON.parse(execFileSync("gh", ["pr", "list", "--state", "open", "--limit", "200", "--json", "number,headRefName"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })) as { number: number; headRefName: string }[];
    return open.filter((p) => p.number !== pr.number && branchKey(p.headRefName) === key).map((p) => p.number);
  } catch {
    logged.push(`gh could not list the open PRs: if ${key} has more, CLAIM them again after the RELEASE.`);
    return [];
  }
}
