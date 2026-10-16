// Removes the merged agent worktrees (.claude/worktrees/agent-*) `/implement-spec`
// leaves behind: those whose branch is merged into the target branch, or whose HEAD
// is detached with no unique commits. Each goes with its leftover folder (node_modules
// included) and its branch (`git branch -D` when the branch is an ancestor of the
// target, whichever branch the main folder has checked out; otherwise it is kept and
// named), plus the `worktree-agent-*` branch the app created it on. Worktrees with
// uncommitted changes or unmerged commits are never touched, nor, without
// --include-empty, those whose branch has no commit of its own yet while a live lock or
// a running process still holds them: their subagent may still be running. With nothing
// holding it, such a worktree is finished and goes, the same rule lane:env, lanes:prune
// and worktrees:prune use (RP-585). Nor, even with --only, one an open Claude desktop
// session holds by the app's own record of its path (desktop-sessions.ts, RP-608).
// They are listed as skipped. The sessions are read again just before each removal,
// and a worktree a session opened after the prompt is kept and named. The dev servers each
// removed worktree still runs (servers.ts, as `pnpm servers:stop` finds them) are listed
// with it and stopped just before it is removed; one that cannot be stopped keeps its
// worktree (RP-568).
//
// It fetches origin first and checks against `origin/<branch>` when that exists, so a
// stale local `main` no longer hides merged worktrees (RP-564); the local branch is
// used when it is ahead of origin's or has none. It prints the ref it used.
//
// Of the skipped it also lists, read-only, the stale ones: nothing committed or changed
// for --stale-days (default 7), with age, branch and the lock's pid state (RP-506).
//
//   pnpm worktrees:clean [--into <branch>] [--include-empty] [--only <agent-id>...] [--stale-days <n>] [--yes]
//
// --only limits the run to the named agent-* worktrees (a session's own stopped
// implementers), removed even with no commits; other sessions' worktrees are left
// out of the run. Uncommitted changes or unmerged commits still skip a named one.
//
// The default branch is main; --yes skips the confirmation.
import { resolve } from "node:path";
import { confirmOrExit } from "./confirm.ts";
import { openSessionReason, readDesktopSessions, type DesktopSessions } from "./desktop-sessions.ts";
import { describeServer, findServersOf, firstLine, stopServers, type Server } from "./servers.ts";
import { DEFAULT_STALE_DAYS, printStale, staleDaysAt } from "./worktrees-stale.ts";
import { CURRENT_WORKTREE, chooseWorktrees, currentRoot, fetchPrune, gatherFacts, gitError, isAgentWorktree, isAncestor, isNamed, listWorktrees, pruneWorktrees, refExists, removeWorktree, reportRemoval, systemLiveness } from "./worktrees.ts";

/** The git queries resolveTarget needs; injected so tests run without a repository. */
export interface TargetGit {
  fetch(): void;
  exists(ref: string): boolean;
  /** Whether a is an ancestor of (or equal to) b. */
  isAncestor(a: string, b: string): boolean;
}

/**
 * The ref `--into <target>` checks against, after fetching origin: `origin/<target>`
 * when it exists, unless the local branch is ahead of it (merged in, not pushed yet);
 * the local branch when origin has none. `lines` say which ref, for the output.
 * No ref when neither exists.
 */
export function resolveTarget(target: string, git: TargetGit): { ref: string | undefined; lines: string[] } {
  const remote = target.startsWith("origin/") ? target : `origin/${target}`;
  const lines: string[] = [];
  try {
    git.fetch();
  } catch (error) {
    lines.push(`git fetch origin failed (${gitError(error)}); ${remote} may be behind.`);
  }
  const hasRemote = git.exists(remote);
  const hasLocal = remote !== target && git.exists(target);
  let ref: string | undefined;
  let why = "";
  if (hasRemote && hasLocal && !git.isAncestor(target, remote) && git.isAncestor(remote, target)) {
    ref = target;
    why = ` (ahead of ${remote})`;
  } else if (hasRemote) ref = remote;
  else if (hasLocal) {
    ref = target;
    why = ` (no ${remote})`;
  }
  if (ref !== undefined) lines.push(`Checking against ${ref}${why}.`);
  return { ref, lines };
}

/**
 * Why a worktree chosen for removal stays after all: a desktop session holds it now, by
 * the app's records read again just before removing it (a session may open one after the
 * prompt, as in worktrees:prune's changedSinceListed); undefined when it still goes.
 */
export function openedSinceListed(path: string, openSession: DesktopSessions): string | undefined {
  const session = openSession(path);
  return session === undefined ? undefined : openSessionReason(session, { sinceListed: true });
}

const gitTarget = (cwd: string): TargetGit => ({
  fetch: () => fetchPrune(cwd),
  exists: (ref) => refExists(ref, cwd),
  isAncestor: (a, b) => isAncestor(a, b, cwd),
});

async function main(): Promise<void> {
  const usage = "Usage: pnpm worktrees:clean [--into <branch>] [--include-empty] [--only <agent-id>...] [--stale-days <n>] [--yes]";
  const args = process.argv.slice(2);
  let staleDays = DEFAULT_STALE_DAYS;
  let into = "main";
  let yes = false;
  let includeEmpty = false;
  let only: string[] | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const next = args[i + 1];
    const days = staleDaysAt(args, i);
    if (a === "--yes") yes = true;
    else if (a === "--include-empty") includeEmpty = true;
    else if (days !== undefined) {
      staleDays = days;
      i++;
    } else if (a === "--only" && next && !next.startsWith("--")) {
      only = [];
      while (args[i + 1] && !args[i + 1]!.startsWith("--")) only.push(args[++i]!);
    } else if (a === "--into" && next && !next.startsWith("--")) {
      into = next;
      i++;
    } else {
      console.error(usage);
      process.exit(1);
    }
  }

  const all = listWorktrees();
  const mainRoot = all[0]!.path;
  const { ref: target, lines } = resolveTarget(into, gitTarget(mainRoot));
  for (const line of lines) console.log(line);
  if (target === undefined) {
    console.error(`Branch ${into} not found; pass an existing branch with --into.`);
    process.exit(1);
  }
  const agentWorktrees = all.filter((w) => isAgentWorktree(w.path, mainRoot));
  for (const n of only ?? []) {
    if (!agentWorktrees.some((w) => isNamed(w.path, [n]))) console.log(`Not an agent worktree here, ignored: ${n}`);
  }
  const agents = gatherFacts(agentWorktrees, target, mainRoot, systemLiveness());
  const { remove, skipped } = chooseWorktrees({ worktrees: agents, currentPath: currentRoot(), includeEmpty, only, openSession: readDesktopSessions() });

  const name = (w: { path: string; branch: string | undefined }) => `${w.path} (${w.branch ?? "detached HEAD"})`;
  if (skipped.length > 0) {
    console.log("Skipped:");
    for (const s of skipped) console.log(`  ${name(s.worktree)}: ${s.reason}`);
    printStale(
      skipped.filter((s) => s.reason !== CURRENT_WORKTREE),
      staleDays,
    );
  }
  if (remove.length === 0) {
    console.log(`No agent worktrees merged into ${target} to remove.`);
    process.exit(0);
  }
  // RP-568: each worktree's dev servers are stopped before it is removed, and listed here.
  let servers = new Map<string, Server[]>();
  try {
    servers = findServersOf(
      remove.map((w) => w.path),
      all.map((w) => w.path),
    );
  } catch (error) {
    console.warn(`Could not read the running processes (${firstLine(error)}), so dev servers are not stopped first.`);
  }
  console.log(`Agent worktrees merged into ${target}:`);
  for (const w of remove) {
    console.log(`  ${name(w)}`);
    for (const s of servers.get(w.path) ?? []) console.log(`    dev server to stop: ${describeServer(s)}`);
  }

  await confirmOrExit("Stop their dev servers and remove them with their folders and branches?", { yes, verb: "remove", done: "removed" });

  let failed = 0;
  for (const w of remove) {
    // Read again just before each removal: a session may have opened it since the prompt (RP-608).
    const opened = openedSinceListed(w.path, readDesktopSessions());
    if (opened) {
      console.log(`Kept ${name(w)}: ${opened}.`);
      continue;
    }
    const notStopped = stopServers(servers.get(w.path) ?? []);
    if (notStopped.length > 0) {
      failed++;
      for (const { server, reason } of notStopped) console.error(`Kept ${w.path}: could not stop its dev server pid ${server.pid} (${reason}).`);
      continue;
    }
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
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) await main();
