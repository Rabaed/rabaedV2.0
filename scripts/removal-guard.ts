import { basename, dirname, resolve } from "node:path";
import { composeProjectOfEnv, protectedLaneReason, readWorktreeEnv } from "./lanes.ts";
import { isMainCheckout, normalPath } from "./paths.ts";

// RP-1198: every helper that removes a worktree or deletes a folder refuses on its own, whatever its
// caller checked (#583's lane:done nearly shipped without the refusals, and could have `rd`'d a
// checkout outside .claude/worktrees). The facts are read here, from the disk, never from the caller:
//   - never the main checkout (its .git is a directory), lane 7's worktree (its .env names
//     rabaed-lane7: Main 7's harness data) or the folder this process runs in, in any way;
//   - a folder is deleted (rd, rm -rf, rmSync) only directly inside `<main checkout>/.claude/worktrees/`,
//     after resolving `..` and normalising case and slashes. Elsewhere only `git worktree remove` without
//     --force, of a worktree git lists, may remove one: git then keeps a worktree with changes (owner, RP-1198).

/** What a delete helper returns instead of acting: why it would not (RP-1198). */
export type Refused = { refused: string };

/** Whether a helper's result is its refusal. */
export const isRefused = (result: unknown): result is Refused => typeof result === "object" && result !== null && typeof (result as Partial<Refused>).refused === "string";

const notRemoved = (path: string, why: string) => `Not removed: ${path} is ${why}.`;

/**
 * What the folder is that nothing removes, or undefined: a main checkout, the folder this process runs
 * in (or one holding it), or lane 7's worktree by its .env (or a folder whose .env cannot be read).
 */
export function neverRemovedReason(path: string, platform: NodeJS.Platform = process.platform): string | undefined {
  const full = resolve(path);
  if (isMainCheckout(full)) return "the main checkout";
  const here = normalPath(resolve(process.cwd()), platform);
  const target = normalPath(full, platform);
  if (here === target || here.startsWith(`${target}/`)) return "the folder this runs in";
  let env: string | undefined;
  try {
    env = readWorktreeEnv(full);
  } catch (error) {
    return `a folder whose .env could not be read (${(error as Error).message}), so whether it is lane 7's is not known`;
  }
  const harness = protectedLaneReason(composeProjectOfEnv(env ?? ""));
  return harness === undefined ? undefined : `lane 7's worktree: ${harness}`;
}

/** Why no helper may remove this folder in any way, `git worktree remove` included (neverRemovedReason), or undefined. */
export function worktreeRemovalRefusal(path: string, platform: NodeJS.Platform = process.platform): string | undefined {
  const reason = neverRemovedReason(path, platform);
  return reason === undefined ? undefined : notRemoved(resolve(path), reason);
}

/**
 * Why a helper may not delete this folder with rd, rm -rf or rmSync, or undefined: worktreeRemovalRefusal's
 * reasons, or it is not a folder directly inside a main checkout's .claude/worktrees/.
 */
export function folderDeletionRefusal(path: string, platform: NodeJS.Platform = process.platform): string | undefined {
  const never = worktreeRemovalRefusal(path, platform);
  if (never !== undefined) return never;
  const full = resolve(path);
  const worktrees = dirname(full);
  const claude = dirname(worktrees);
  const named = (dir: string, name: string) => normalPath(basename(dir), platform) === name;
  if (named(worktrees, "worktrees") && named(claude, ".claude") && isMainCheckout(dirname(claude))) return undefined;
  return notRemoved(full, "not a folder in a main checkout's .claude/worktrees/, and only `git worktree remove` (without --force) removes a worktree elsewhere");
}
