/* eslint-disable rabaed/no-avoid-terms -- the code-review marker (an HTML comment), node and git's names, as in reviewed-add.ts */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reviewMarker } from "./reviewed-add.ts";

// Posts /code-review's summary on a PR with the marker CI's reviewed-add workflow looks for (RP-1118):
//
//   node scripts/review-post.ts <pr> <summary-file>
//
// /code-review is a Claude Code skill outside this repo, so this script writes the marker for it: the lane saves the
// review's summary (its findings and what was fixed) to a file and runs this after the last fix is pushed. The comment
// starts with `<!-- code-review: <head sha> -->`. CI adds `reviewed` once that comment and a stamped verify line both
// name the head (scripts/reviewed-add.ts). It refuses unless the checkout is clean and its HEAD is the PR's head, so
// the marker names the commit that was reviewed. It runs as the `gh` account, which needs write access to the repo for the marker to count.

const USAGE = "Usage: node scripts/review-post.ts <pr> <summary-file>";

/** The comment: the marker first, then the summary. */
export const reviewComment = (sha: string, summary: string) => `${reviewMarker(sha)}\n**/code-review summary at ${sha}**\n\n${summary.trim()}\n`;

export interface PostSeam {
  /** `git rev-parse HEAD`. */
  head(): string;
  /** `git status --porcelain` lines, untracked files included. */
  dirty(): string[];
  /** The PR's head sha on GitHub. */
  prHead(pr: number): string;
  read(file: string): string;
  post(pr: number, body: string): void;
}

export function postReview(args: string[], seam: PostSeam): { ok: boolean; message: string } {
  const [prArg, file, ...rest] = args;
  const pr = /^[1-9]\d*$/.test(prArg ?? "") ? Number(prArg) : 0;
  if (pr === 0 || file === undefined || rest.length > 0) return { ok: false, message: USAGE };
  const summary = seam.read(file);
  if (summary.trim() === "") return { ok: false, message: `${file} is empty: put /code-review's summary in it.` };
  if (summary.includes("<!-- code-review:")) return { ok: false, message: `${file} already holds a code-review marker; this script writes the marker itself.` };
  const dirty = seam.dirty();
  if (dirty.length > 0) return { ok: false, message: `The checkout has changes (${dirty[0]}${dirty.length > 1 ? `, and ${dirty.length - 1} more` : ""}): commit and push the review's fixes first.` };
  const head = seam.head();
  const prHead = seam.prHead(pr);
  if (head !== prHead) return { ok: false, message: `HEAD is ${head}, but PR #${pr}'s head is ${prHead}: push (or pull) so the review is of the PR's head, then run this again.` };
  seam.post(pr, reviewComment(head, summary));
  return { ok: true, message: `Posted /code-review's summary on PR #${pr} for ${head}. CI adds \`reviewed\` once the body's stamped verify line names this head too.` };
}

function realSeam(cwd: string = process.cwd()): PostSeam {
  const must = (command: string, args: string[], input?: string) => {
    const done = spawnSync(command, args, { cwd, encoding: "utf8", input });
    if (done.status !== 0) throw new Error(`${command} ${args.slice(0, 2).join(" ")} failed:\n${done.stdout ?? ""}${done.stderr ?? ""}`);
    return (done.stdout ?? "").trim();
  };
  return {
    head: () => must("git", ["rev-parse", "HEAD"]),
    dirty: () => must("git", ["status", "--porcelain"]).split("\n").filter(Boolean),
    prHead: (pr) => must("gh", ["pr", "view", String(pr), "--json", "headRefOid", "--jq", ".headRefOid"]),
    read: (file) => readFileSync(file, "utf8"),
    post: (pr, body) => void must("gh", ["pr", "comment", String(pr), "--body-file", "-"], body),
  };
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  try {
    const result = postReview(process.argv.slice(2), realSeam());
    (result.ok ? console.log : console.error)(result.message);
    process.exit(result.ok ? 0 : 1);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
