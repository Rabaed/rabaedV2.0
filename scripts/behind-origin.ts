// RP-1198: whether this checkout is too far behind origin/main to run its own scripts. The main folder
// was 973 commits behind once: `lane:done` did not exist there, and a stale `queue-pr.ts` refused a PR.
// The CLIs that act on worktrees, lanes and PRs call `stopIfBehindOrigin` first. Node builtins only,
// so it runs with plain `node` and no installed packages.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { samePath } from "./paths.ts";

/** Past this many commits behind origin/main, a script stops. */
export const MAX_BEHIND_ORIGIN = 50;
/** How many closer worktrees a stop names. */
const CLOSEST = 3;

export type BehindFacts = {
  /** The command as typed, such as "pnpm lane:done 512". */
  command: string;
  /** This checkout's top folder. */
  here: string;
  /** The clone's main checkout, the first worktree git lists. */
  mainRoot: string;
  /** Commits origin/main has that HEAD does not; undefined when there is no origin/main. */
  behind: number | undefined;
  /** Why `git fetch origin main` failed, when it did. */
  fetchError?: string;
  branch: string | undefined;
  clean: boolean;
  worktrees: { path: string; behind: number }[];
};

export type BehindVerdict = { stop: boolean; lines: string[] };

const commits = (n: number) => `${n} commit${n === 1 ? "" : "s"}`;

/** Nothing when up to date, one line up to `max` behind, and past it what is stale and where to run from instead. */
export function judgeBehindOrigin(facts: BehindFacts, max: number = MAX_BEHIND_ORIGIN): BehindVerdict {
  const lines: string[] = facts.fetchError === undefined ? [] : [`${facts.command}: \`git fetch origin main\` failed (${facts.fetchError}), so it is judged against origin/main as last fetched.`];
  if (facts.behind === undefined) return { stop: false, lines: [...lines, `${facts.command}: origin/main not found, so whether HEAD is behind it was not checked.`] };
  if (facts.behind === 0) return { stop: false, lines };
  if (facts.behind <= max) return { stop: false, lines: [...lines, `${facts.command}: HEAD is ${commits(facts.behind)} behind origin/main (it stops past ${max}); carrying on.`] };
  lines.push(`${facts.command} stopped: HEAD is ${commits(facts.behind)} behind origin/main: this checkout's scripts are older than main's.`);
  const closer = facts.worktrees
    .filter((w) => w.behind <= max && !samePath(w.path, facts.here))
    .sort((a, b) => a.behind - b.behind)
    .slice(0, CLOSEST);
  if (closer.length > 0) {
    lines.push("Run it from a worktree of this clone closer to origin/main:");
    for (const w of closer) lines.push(`  cd "${w.path}"   (${w.behind === 0 ? "up to date with origin/main" : `${commits(w.behind)} behind`})`);
  } else if (facts.branch === "main" && facts.clean) {
    lines.push(`No worktree of this clone is within ${max} commits of origin/main. This checkout is on main with nothing uncommitted: bring it up to date, then run it again:`);
    lines.push("  git merge --ff-only origin/main", "  pnpm install --frozen-lockfile");
  } else {
    const fresh = `${facts.mainRoot.replace(/[\\/]+$/, "")}/.claude/worktrees/origin-main`;
    lines.push(`No worktree of this clone is within ${max} commits of origin/main. Cut a fresh worktree from origin/main and run it there:`);
    lines.push(`  git worktree add --detach "${fresh}" origin/main`, `  cd "${fresh}"`, "  pnpm install --frozen-lockfile");
  }
  lines.push(`  ${facts.command}`);
  return { stop: true, lines };
}

/**
 * A CLI's first step: prints checkBehindOrigin's lines and exits 1 when this checkout is more than
 * `max` commits behind origin/main. `script` is how it is run, such as "pnpm lane:done"; its arguments are added.
 */
export function stopIfBehindOrigin(script: string, options: { cwd?: string; max?: number } = {}): void {
  const command = [script, ...process.argv.slice(2)].join(" ");
  let verdict: BehindVerdict;
  try {
    verdict = checkBehindOrigin(command, options);
  } catch (error) {
    // Not a git checkout, or git missing: the script's own steps say so.
    console.error(`${command}: whether this checkout is behind origin/main was not checked (${firstLine(error)}).`);
    return;
  }
  for (const line of verdict.lines) console.error(line);
  if (verdict.stop) process.exit(1);
}

const FETCH_TIMEOUT_MS = 60_000;

/** Fetches origin main, then judges the checkout at `cwd`; the other worktrees are read only when it stops. */
export function checkBehindOrigin(command: string, { cwd = process.cwd(), max = MAX_BEHIND_ORIGIN }: { cwd?: string; max?: number } = {}): BehindVerdict {
  const git = (args: string[], timeout?: number) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout }).trim();
  const attempt = (args: string[]) => {
    try {
      return git(args);
    } catch {
      return undefined;
    }
  };
  let fetchError: string | undefined;
  try {
    git(["fetch", "origin", "main", "--quiet"], FETCH_TIMEOUT_MS);
  } catch (error) {
    fetchError = firstLine(error);
  }
  const behindOf = (rev: string) => {
    const count = attempt(["rev-list", "--count", `${rev}..origin/main`]);
    return count === undefined ? undefined : Number(count);
  };
  const behind = behindOf("HEAD");
  const here = git(["rev-parse", "--show-toplevel"]);
  const facts: BehindFacts = { command, here, mainRoot: here, behind, fetchError, branch: undefined, clean: false, worktrees: [] };
  if (behind !== undefined && behind > max) {
    const listed = parseWorktreeHeads(git(["worktree", "list", "--porcelain"]));
    facts.mainRoot = listed[0]?.path ?? here;
    facts.branch = attempt(["symbolic-ref", "--short", "-q", "HEAD"]);
    facts.clean = attempt(["status", "--porcelain"]) === "";
    for (const w of listed) {
      if (samePath(w.path, here) || !existsSync(w.path)) continue;
      const n = behindOf(w.head);
      if (n !== undefined) facts.worktrees.push({ path: w.path, behind: n });
    }
  }
  return judgeBehindOrigin(facts, max);
}

/** Each worktree's path and HEAD from `git worktree list --porcelain`; a bare entry has no HEAD and is left out. */
function parseWorktreeHeads(out: string): { path: string; head: string }[] {
  const heads: { path: string; head: string }[] = [];
  for (const block of out.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const path = lines.find((l) => l.startsWith("worktree "))?.slice("worktree ".length);
    const head = lines.find((l) => l.startsWith("HEAD "))?.slice("HEAD ".length);
    if (path !== undefined && head !== undefined) heads.push({ path, head });
  }
  return heads;
}

function firstLine(error: unknown): string {
  const { stderr, message } = error as { stderr?: string; message?: string };
  const text = `${stderr ?? ""}\n${message ?? String(error)}`;
  return text.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== "") ?? "no reason given";
}
