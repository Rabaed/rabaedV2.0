/* eslint-disable rabaed/no-avoid-terms -- the code-review marker (an HTML comment), node and git's names, as in reviewed-add.ts */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reviewMarker } from "./reviewed-add.ts";
import { BASELINE_MARKER_START, baselineMarker } from "./verify-gate.ts";

// Posts /code-review's summary on a PR with the marker CI's reviewed-add workflow looks for (RP-1118):
//
//   node scripts/review-post.ts <pr> <summary-file>
//
// /code-review is a Claude Code skill outside this repo, so this script writes the marker for it: the lane saves the
// review's summary (its findings and what was fixed) to a file and runs this after the last fix is pushed. The comment
// starts with `<!-- code-review: <head sha> -->`. CI adds `reviewed` once that comment and a stamped verify line both
// name the head (scripts/reviewed-add.ts). It refuses unless the checkout is clean and its HEAD is the PR's head, so
// the marker names the commit that was reviewed, and unless the PR body holds `<!-- implement: RP-nnn -->` on a line of
// its own, naming the key the branch starts with (RP-1195 item 4), or the PR changes only docs. It runs as the `gh` account, which needs write access to the repo for the marker to count.

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
  /** The PR's body on GitHub ("" when it has none). */
  body(pr: number): string;
  /** The PR's head branch name (`headRefName`). */
  branch(pr: number): string;
  /** The paths the PR changes, a rename's old path included; throws when the list can't be read. */
  changedFiles(pr: number): string[];
  post(pr: number, body: string): void;
}

// RP-1195 item 4: the PR body names the ticket it was built for through /implement or /implement-spec (the project skill
// `rabaed-implement` writes it): `<!-- implement: RP-123 -->`, one or more; a spec's integration PR names the spec key.
// Kept inline: review-post.ts is a gate script, and a module it imports would become a gate path.
// It counts only on a line of its own, outside a fenced code block (so not quoted after `>` either): a body quoting the
// marker as an example is not marked (RP-1195 review).
const IMPLEMENT_LINE = /^<!-- implement: (RP-\d+) -->$/gm;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** The keys of the body's implement markers, in order; pr-status.ts reads the body with this too. */
export function implementKeys(body: string): string[] {
  const kept: string[] = [];
  let fence: string | undefined;
  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    const opens = FENCE.exec(line)?.[1];
    if (fence === undefined && opens !== undefined) fence = opens;
    else if (fence !== undefined && opens !== undefined && opens[0] === fence[0] && opens.length >= fence.length && line.trim() === opens) fence = undefined;
    else if (fence === undefined) kept.push(line);
  }
  return [...kept.join("\n").matchAll(IMPLEMENT_LINE)].map(([, key = ""]) => key);
}

/** The RP key a branch name starts with (`RP-1195-pr-tools` is RP-1195); undefined when it has none. */
const branchKey = (branch: string) => /^(RP-\d+)(?:-|$)/.exec(branch)?.[1];
// A doc as rule 3 counts one (reviewed-required.ts `isDoc`): under docs/ or Markdown. The Orchestrator's rule files
// (CODING_STANDARDS.md, planning/parallel-sessions.md, docs/agents/**) are all docs by it.
const isDoc = (file: string) => file.startsWith("docs/") || file.endsWith(".md");

/**
 * Whether a PR needs no implement marker: it changes only docs. Judged by its files, never by its `docs-only` label,
 * which a lane can set on a code PR. Fails closed: an unreadable file list exempts nothing.
 */
function markerExempt(pr: number, seam: PostSeam): boolean {
  try {
    const files = seam.changedFiles(pr);
    return files.length > 0 && files.every(isDoc);
  } catch {
    return false;
  }
}

export type Checked = { ok: true; pr: number; head: string; summary: string } | { ok: false; message: string };

/** Every refusal of `postReview`, with nothing posted or changed. `pnpm lane:ready` runs it before it marks a PR ready. */
export function checkReview(args: string[], seam: PostSeam): Checked {
  const [prArg, file, ...rest] = args;
  const pr = /^[1-9]\d*$/.test(prArg ?? "") ? Number(prArg) : 0;
  if (pr === 0 || file === undefined || rest.length > 0) return { ok: false, message: USAGE };
  const summary = seam.read(file);
  if (summary.trim() === "") return { ok: false, message: `${file} is empty: put /code-review's summary in it.` };
  if (summary.includes("<!-- code-review:")) return { ok: false, message: `${file} already holds a code-review marker; this script writes the marker itself.` };
  // RP-1194: the lane's review step never approves its own baseline entry (scripts/verify-gate.ts `baselineMarker`).
  if (summary.includes(BASELINE_MARKER_START)) {
    return { ok: false, message: `${file} holds Main 6's baseline marker (\`${baselineMarker("<sha>")}\`); only Main 6 posts it, after its own review, never through this script.` };
  }
  const dirty = seam.dirty();
  if (dirty.length > 0) return { ok: false, message: `The checkout has changes (${dirty[0]}${dirty.length > 1 ? `, and ${dirty.length - 1} more` : ""}): commit and push the review's fixes first.` };
  const head = seam.head();
  const prHead = seam.prHead(pr);
  if (head !== prHead) return { ok: false, message: `HEAD is ${head}, but PR #${pr}'s head is ${prHead}: push (or pull) so the review is of the PR's head, then run this again.` };
  const marker = implementRefusal(pr, seam);
  if (marker !== undefined) return { ok: false, message: marker };
  return { ok: true, pr, head, summary };
}

/**
 * Why the PR's implement marker does not pass, or undefined when it does: one marker, on a line of its own, must name the
 * RP key the PR's branch starts with (RP-1195 review), so a marker copied from another PR does not count. A PR changing
 * only docs needs none.
 */
function implementRefusal(pr: number, seam: PostSeam): string | undefined {
  const branch = seam.branch(pr);
  const key = branchKey(branch);
  const keys = implementKeys(seam.body(pr));
  if (key !== undefined && keys.includes(key)) return undefined;
  if (markerExempt(pr, seam)) return undefined;
  if (key === undefined) {
    return `PR #${pr}'s branch ${branch} has no RP key at its start (RP-nnn-…), so no implement marker can name it: open the PR from a branch named after its ticket, through the \`rabaed-implement\` skill.`;
  }
  const found = keys.length === 0 ? "has no `<!-- implement: RP-nnn -->` line" : `names ${keys.join(", ")}, not the branch's ${key}`;
  return (
    `PR #${pr}'s body ${found} (RP-1195): build it through the \`rabaed-implement\` skill, which writes the marker (/implement or /implement-spec). ` +
    `Only for a PR opened before RP-1195 merged: add the line \`<!-- implement: ${key} -->\` on its own to the body with \`gh pr edit ${pr} --body-file <file>\`, then run this again. ` +
    `A PR changing only docs needs none.`
  );
}

export function postReview(args: string[], seam: PostSeam): { ok: boolean; message: string } {
  const checked = checkReview(args, seam);
  if (!checked.ok) return checked;
  const { pr, head, summary } = checked;
  seam.post(pr, reviewComment(head, summary));
  return { ok: true, message: `Posted /code-review's summary on PR #${pr} for ${head}. CI adds \`reviewed\` once the body's stamped verify line names this head too.` };
}

export function realSeam(cwd: string = process.cwd()): PostSeam {
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
    body: (pr) => must("gh", ["pr", "view", String(pr), "--json", "body", "--jq", ".body"]),
    branch: (pr) => (JSON.parse(must("gh", ["pr", "view", String(pr), "--json", "headRefName"])) as { headRefName: string }).headRefName,
    // The REST list pages past gh pr view's 100 files; a rename's old path counts, as everywhere (RP-606).
    changedFiles: (pr) =>
      must("gh", ["api", "--paginate", `repos/{owner}/{repo}/pulls/${pr}/files`, "--jq", ".[] | .filename, (.previous_filename // empty)"]).split("\n").filter(Boolean),
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
