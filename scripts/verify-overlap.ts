/* eslint-disable rabaed/no-avoid-terms -- git's changed files, and the warning's own "check", by their own names */

import { branchOverlaps } from "./check-claims.ts";

// The open-PR overlap look at the top of `pnpm verify` (RP-1191): other open PRs that change this branch's files,
// which would conflict, and the merge order (scripts/pr-overlap.ts, RP-1172). A warning only: it never stops a run,
// so a look that fails, or hangs on GitHub, becomes one line saying it did not look.

/**
 * Longest a verify waits for the look (GitHub, and one `git fetch` per overlapping PR). A look that outlasts it is
 * not cancelled: its `gh` and `git` children end on their own timeouts (pr-overlap.ts), and the verify goes on.
 */
const OVERLAP_WAIT_MS = 30_000;

/** The overlap warning for the branch checked out in `repo`: "" when there is none; never throws. */
export async function verifyOverlap(repo: string, look: (repo: string) => Promise<string> = branchOverlaps, waitMs = OVERLAP_WAIT_MS): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  const gaveUp = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer after ${waitMs} ms`)), waitMs);
  });
  try {
    return await Promise.race([look(repo), gaveUp]);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return `Warning: pnpm verify could not look for open PRs that change the same files (${reason}); it did not check for overlaps.`;
  } finally {
    clearTimeout(timer);
  }
}
