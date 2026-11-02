import { formatAge } from "./lane-rows.ts";
import type { IdleOf, RunningStack } from "./machine-load.ts";
import { readActivity, type Activity } from "./worktrees-stale.ts";

// How long a running stack has sat idle (RP-1197, item 3). The stack cap (RP-1096) refuses a lane:env
// when too many stacks run; the refusal names each stack with its idle time, so the one to ask about
// is the one idle longest. Idle is the same figure `pnpm lanes` prints: the time since the newest
// commit or uncommitted change in the stack's folders.

/** The newest activity time (ms) in a folder, or undefined when it has none or is gone. */
export function lastActivity(dir: string, read: (dir: string) => Activity | undefined = readActivity): number | undefined {
  const a = read(dir);
  const times = [a?.lastCommit, a?.newestChange].filter((t): t is number => t !== undefined);
  return times.length === 0 ? undefined : Math.max(...times);
}

/**
 * An IdleOf for stackCap: "idle 3 h" from the newest activity across the stack's folders, or
 * "idle unknown" when none of them has any (a folder that is gone, or no folder label).
 */
export function idleOfStack(activityOf: (dir: string) => number | undefined = (dir) => lastActivity(dir), now: number = Date.now()): IdleOf {
  return (stack: RunningStack) => {
    const times = stack.dirs.map(activityOf).filter((t): t is number => t !== undefined);
    return times.length === 0 ? "idle unknown" : `idle ${formatAge(Math.max(0, now - Math.max(...times)))}`;
  };
}
