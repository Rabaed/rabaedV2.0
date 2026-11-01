// RP-1198: stops a script run from a checkout more than MAX_BEHIND_ORIGIN (50) merged PRs (first-parent
// commits) behind origin/main, whose scripts are then older than main's. The main folder was 973 commits
// behind once: `lane:done` did
// not exist there, and a stale `queue-pr.ts` refused a PR. Up to the limit it is silent. Past it, it names
// where to run from instead: the closest worktrees of this clone that no live session holds (never a
// subagent's agent-* one), else a fast-forward of a clean main, else a fresh worktree from origin/main.
// The CLIs that act on worktrees, lanes and PRs call `stopIfBehindOrigin` after parsing their arguments,
// before any fetch or removal. Node builtins only (worktrees.ts and claude-sessions.ts are too), so it
// runs with plain `node` and no installed packages.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { holdReason, systemHolders, type Holders } from "./claude-sessions.ts";
import { samePath } from "./paths.ts";
import { gitError, isAgentWorktree, isShallowRepo, parseWorktrees } from "./worktrees.ts";

/** More than this many merged PRs behind origin/main, a script stops. */
export const MAX_BEHIND_ORIGIN = 50;
/** How many closer worktrees a stop names. */
const CLOSEST = 3;
const FETCH_TIMEOUT_MS = 60_000;

/** What a stop's advice needs; read only when the checkout is too far behind. */
export type StaleFacts = {
  /** The clone's main checkout: the first worktree git lists (worktrees.ts), the bare folder in a bare clone. */
  mainRoot: string;
  /** A folder that does not exist yet, for the fresh worktree a stop may suggest. */
  freshPath: string;
  branch: string | undefined;
  /** No uncommitted changes to tracked files (untracked files do not stop `git merge --ff-only`). */
  clean: boolean;
  /** Commits HEAD has that origin/main does not; undefined when git cannot count them. */
  ahead: number | undefined;
  /** The clone's other worktrees, each with its merged PRs behind; held: a live Claude session holds it, or the sessions could not be read. */
  worktrees: { path: string; behind: number; held?: boolean }[];
};

export type BehindFacts = {
  /** The command as typed, such as "pnpm lane:done 512". */
  command: string;
  /** This checkout's top folder. */
  here: string;
  /** A shallow clone cannot count how far behind it is. */
  shallow: boolean;
  /** Merged PRs origin/main has that HEAD does not; undefined when there is no origin/main. */
  behind: number | undefined;
  /** Why `git fetch origin main` failed, when it did. */
  fetchError?: string;
  stale?: StaleFacts;
};

export type BehindVerdict = { stop: boolean; lines: string[] };

const mergedPrCount = (n: number) => `${n} merged PR${n === 1 ? "" : "s"}`;

/** Silent up to `max` behind; past it, it stops, with advice once given the stale checkout's facts. */
export function judgeBehindOrigin(facts: BehindFacts, max: number = MAX_BEHIND_ORIGIN): BehindVerdict {
  const { command, stale } = facts;
  if (facts.shallow) return { stop: false, lines: [`${command}: this clone is shallow, so how far HEAD is behind origin/main cannot be counted; not checked.`] };
  const lines: string[] = facts.fetchError === undefined ? [] : [`${command}: \`git fetch origin main\` failed (${facts.fetchError}), so it is judged against origin/main as last fetched.`];
  if (facts.behind === undefined) return { stop: false, lines: [...lines, `${command}: origin/main not found, so whether HEAD is behind it was not checked.`] };
  if (facts.behind <= max) return { stop: false, lines };
  lines.push(`${command} stopped: HEAD is ${mergedPrCount(facts.behind)} behind origin/main: this checkout's scripts are older than main's.`);
  if (stale === undefined) return { stop: true, lines };
  // Never a subagent's worktree, nor one a live session holds: the prunes this guards remove them,
  // and a clean-up run from another lane's worktree protects that one instead of your own.
  const isMain = (path: string) => samePath(path, stale.mainRoot);
  const closer = stale.worktrees
    .filter((w) => w.behind <= max && !w.held && !samePath(w.path, facts.here) && !isAgentWorktree(w.path, stale.mainRoot))
    .sort((a, b) => a.behind - b.behind || Number(isMain(a.path)) - Number(isMain(b.path)))
    .slice(0, CLOSEST);
  if (closer.length > 0) {
    lines.push("Run it from a worktree of this clone closer to origin/main:");
    for (const w of closer) lines.push(`  cd "${w.path}"   (${w.behind === 0 ? "up to date with origin/main" : `${mergedPrCount(w.behind)} behind`})`);
  } else if (stale.branch === "main" && stale.clean && stale.ahead === 0) {
    lines.push(`No worktree of this clone is within ${mergedPrCount(max)} of origin/main. This checkout is on main with no uncommitted tracked changes and nothing origin/main lacks: bring it up to date, then run it again:`);
    lines.push("  git merge --ff-only origin/main", "  pnpm install --frozen-lockfile");
  } else {
    lines.push(`No worktree of this clone is within ${mergedPrCount(max)} of origin/main. Cut a fresh worktree from origin/main and run it there:`);
    lines.push(`  git worktree add --detach "${stale.freshPath}" origin/main`, `  cd "${stale.freshPath}"`, "  pnpm install --frozen-lockfile");
  }
  lines.push(`  ${command}`);
  return { stop: true, lines };
}

type CheckOptions = { cwd?: string; max?: number; now?: Date; holders?: () => Holders };

/**
 * A CLI's guard: prints checkBehindOrigin's lines to stderr and exits 1 on a stop. `script` is how it is
 * run, such as "pnpm lane:done"; the arguments are added. The options are for tests.
 */
export function stopIfBehindOrigin(
  script: string,
  { argv = process.argv.slice(2), write = (line: string) => console.error(line), exit = (code: number) => process.exit(code), ...options }: CheckOptions & { argv?: string[]; write?: (line: string) => void; exit?: (code: number) => void } = {},
): void {
  const command = [script, ...argv].join(" ");
  let verdict: BehindVerdict;
  try {
    verdict = checkBehindOrigin(command, options);
  } catch (error) {
    // Not a git checkout, or git missing: the script's own steps say so.
    write(`${command}: whether this checkout is behind origin/main was not checked (${oneLine(error)}).`);
    return;
  }
  for (const line of verdict.lines) write(line);
  if (verdict.stop) exit(1);
}

/** Fetches origin main (never prompting), then judges the checkout at `cwd`; throws outside a checkout, before any fetch. */
export function checkBehindOrigin(command: string, { cwd = process.cwd(), max = MAX_BEHIND_ORIGIN, now = new Date(), holders = systemHolders }: CheckOptions = {}): BehindVerdict {
  const git = (args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const gitOrUndefined = (args: string[]) => {
    try {
      return git(args);
    } catch {
      return undefined;
    }
  };
  const here = git(["rev-parse", "--show-toplevel"]);
  if (isShallowRepo(cwd)) return judgeBehindOrigin({ command, here, shallow: true, behind: undefined }, max);
  let fetchError: string | undefined;
  try {
    execFileSync("git", ["fetch", "origin", "main", "--quiet"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: FETCH_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
    });
  } catch (error) {
    fetchError = oneLine(error);
  }
  const count = (range: string, ...flags: string[]) => {
    const out = gitOrUndefined(["rev-list", "--count", ...flags, range]);
    return out === undefined ? undefined : Number(out);
  };
  /** The one place behind is counted: merged PRs (first-parent commits) origin/main has that `rev` does not (owner, 2026-11-01). */
  const mergedPrsBehind = (rev: string) => count(`${rev}..origin/main`, "--first-parent");
  const facts: BehindFacts = { command, here, shallow: false, behind: mergedPrsBehind("HEAD"), fetchError };
  const first = judgeBehindOrigin(facts, max);
  if (!first.stop) return first;
  const listed = parseWorktrees(git(["worktree", "list", "--porcelain"]));
  const mainRoot = listed[0]?.path ?? here;
  let heldBy: (path: string) => boolean;
  try {
    const read = holders();
    heldBy = (path) => holdReason(path, read) !== undefined;
  } catch {
    heldBy = () => true;
  }
  const worktrees: StaleFacts["worktrees"] = [];
  for (const w of listed) {
    // A bare clone's own entry has no HEAD.
    if (w.head === "" || samePath(w.path, here) || !existsSync(w.path)) continue;
    const behind = mergedPrsBehind(w.head);
    if (behind !== undefined) worktrees.push({ path: w.path, behind, held: safely(() => heldBy(w.path)) });
  }
  facts.stale = {
    mainRoot,
    freshPath: freshWorktreePath(mainRoot, now),
    branch: gitOrUndefined(["symbolic-ref", "--short", "-q", "HEAD"]),
    clean: gitOrUndefined(["status", "--porcelain", "--untracked-files=no"]) === "",
    ahead: count("origin/main..HEAD"),
    worktrees,
  };
  return judgeBehindOrigin(facts, max);
}

/** A hold check that throws counts as held. */
function safely(held: () => boolean): boolean {
  try {
    return held();
  } catch {
    return true;
  }
}

/** `<mainRoot>/.claude/worktrees/origin-main-YYYYMMDD`, with -2, -3 … when that folder exists. */
function freshWorktreePath(mainRoot: string, now: Date): string {
  const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const base = `${mainRoot.replace(/[\\/]+$/, "")}/.claude/worktrees/origin-main-${day}`;
  let path = base;
  for (let n = 2; existsSync(path); n++) path = `${base}-${n}`;
  return path;
}

/** gitError's first line, for a one-line message. */
const oneLine = (error: unknown) => gitError(error).split(/\r?\n/)[0]!.trim();
