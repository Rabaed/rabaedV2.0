/* eslint-disable rabaed/no-avoid-terms -- gh and git's names, as in review-post.ts */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { checkReview, postChecked, realSeam as postSeam, type PostSeam } from "./review-post.ts";

// Marks a lane's PR ready for review and posts its /code-review summary, in one command (RP-1195 item 1):
//
//   node scripts/lane-ready.ts <pr> <summary-file>
//
// It checks everything review-post.ts checks first (a clean checkout whose HEAD is the PR's head, the PR body's
// implement marker, the summary), so a refusal changes nothing. Then `gh pr ready` (skipped when the PR is not a draft),
// then the review comment, as review-post.ts posts it. Marking ready first means reviewed-add, which skips drafts,
// sees a ready PR when the comment lands.

const USAGE =
  "Usage: node scripts/lane-ready.ts <pr> <summary-file>\n" +
  "Keep the summary file outside the worktree (e.g. your scratchpad): an untracked file inside it makes the checkout dirty, and this refuses.";

export interface ReadySeam extends PostSeam {
  /** Whether the PR is a draft on GitHub. */
  isDraft(pr: number): boolean;
  /** `gh pr ready <pr>`. */
  markReady(pr: number): void;
}

export function laneReady(args: string[], seam: ReadySeam): { ok: boolean; message: string } {
  const checked = checkReview(args, seam);
  if (!checked.ok) return { ok: false, message: checked.usage ? USAGE : checked.message };
  const { pr } = checked;
  const marked = seam.isDraft(pr);
  if (marked) seam.markReady(pr);
  // Checked once above; postChecked reads only the PR's head again, so a push since still refuses (RP-1195 review).
  let posted: { ok: boolean; message: string };
  try {
    posted = postChecked(checked, seam);
  } catch (error: unknown) {
    posted = { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  if (!posted.ok) return { ok: false, message: `PR #${pr} is ready for review, but holds no review comment: ${posted.message}` };
  return { ok: true, message: `${marked ? `Marked PR #${pr} ready for review. ` : ""}${posted.message}` };
}

export function realSeam(cwd: string = process.cwd(), spawn: typeof spawnSync = spawnSync): ReadySeam {
  const must = (command: string, args: string[]) => {
    const done = spawn(command, args, { cwd, encoding: "utf8" });
    if (done.status !== 0) throw new Error(`${command} ${args.slice(0, 2).join(" ")} failed:\n${done.stdout ?? ""}${done.stderr ?? ""}`);
    return (done.stdout ?? "").trim();
  };
  return {
    ...postSeam(cwd, spawn),
    isDraft: (pr) => (JSON.parse(must("gh", ["pr", "view", String(pr), "--json", "isDraft"])) as { isDraft: boolean }).isDraft === true,
    markReady: (pr) => void must("gh", ["pr", "ready", String(pr)]),
  };
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  try {
    const result = laneReady(process.argv.slice(2), realSeam());
    (result.ok ? console.log : console.error)(result.message);
    process.exit(result.ok ? 0 : 1);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
