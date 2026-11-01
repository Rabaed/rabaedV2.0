import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Removes the `reviewed` label from a pull request when a push lands on it (RP-584).
// Run by .github/workflows/reviewed-label.yml on pull_request: synchronize, and on
// opened and reopened (RP-604) so that every head has a run `pnpm queue` can wait for.
// A label already there when a PR opens or reopens is dropped: no review is tied to that head.
//
// The label means "/code-review finished and its fixes are pushed, at this head":
// `pnpm queue` refuses a PR without it. So a new push drops it, with two exceptions.
// A push that only merges main in, by a clean automatic merge, keeps it (RP-584).
// "Clean automatic merge" is checked, not guessed:
//   1. the new head is a merge commit with two parents,
//   2. the first parent is the head the push replaced (`before`),
//   3. the second parent is already on origin/main (not another feature branch),
//   4. the tree of the new head equals the tree `git merge-tree` makes by merging
//      that second parent into `before`, so nobody edited anything while merging
//      (a conflict resolution, an "evil merge", or extra changes fail this).
// A bot's push of one screenshot baseline-only commit on `before` keeps it too
// (`baselineBotPush`, RP-1121): it changes no code, and CI's story run checks the images.
// The sender must be a bot account (the screenshot workflow's App): anyone can write the
// bot's email into a commit, but lanes push as people.
// Anything else, including any error while checking, removes the label: a missing
// label costs one `gh pr edit`, a stale one lets unreviewed code into main.
// `pnpm queue` and the verify gate follow both back from the head to the commit `pnpm verify`
// passed on (`onlyCleanCommitsSince`, RP-1017, RP-1103), so there is one definition of each.
//
// Environment: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_PATH. Runs the default
// branch's copy of this file in a checkout that has main's history and the PR head;
// it runs no PR code.

export const REVIEWED_LABEL = "reviewed";

export interface ReviewedGit {
  /** Parent commits of `commit`, first parent first. */
  parents(commit: string): string[];
  /** True when `commit` is on origin/main (an ancestor of it, or the tip). */
  onMain(commit: string): boolean;
  /** The tree id of `commit`. */
  tree(commit: string): string;
  /** The tree id of the clean merge of `other` into `base` (`git merge-tree --write-tree`); undefined when it conflicts or errors. */
  mergedTree(base: string, other: string): string | undefined;
  /** The author's and the committer's email of `commit`. */
  identity(commit: string): { author: string; committer: string };
  /** The paths `commit` changes against its parent, both sides of a rename (`git diff-tree --no-renames`). */
  changedPaths(commit: string): string[];
}

/** Where CI's update-screenshots workflow keeps the story screenshot baselines (its `SCREENSHOTS`). */
export const BASELINE_FOLDER = "packages/ui/test/__screenshots__";
/** The email that workflow commits as, author and committer alike (its `git config` email). */
// eslint-disable-next-line rabaed/no-avoid-terms -- GitHub's own noreply address for its Actions bot.
export const BASELINE_BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";

/**
 * True for CI's "Update story screenshot baselines" commit (RP-1103): one parent, authored and committed by the
 * workflow's bot, changing only PNGs under the baseline folder, at least one. It changes no code, so it does not
 * void a verify line: `pnpm verify` compares no screenshots off Linux, and CI checks them. Anyone can set a commit's
 * author, but such a commit still changes only baseline images, which CI's story run then checks; a mixed commit,
 * or one a person made or re-committed (a cherry-pick, a rebase), never counts.
 */
export function isBaselineBotCommit(commit: string, git: ReviewedGit): boolean {
  try {
    if (git.parents(commit).length !== 1) return false;
    const { author, committer } = git.identity(commit);
    if (author !== BASELINE_BOT_EMAIL || committer !== BASELINE_BOT_EMAIL) return false;
    const paths = git.changedPaths(commit);
    return paths.length > 0 && paths.every((path) => path.startsWith(`${BASELINE_FOLDER}/`) && path.endsWith(".png"));
  } catch {
    return false;
  }
}

/** True when the push `before` -> `after` only merged main in, with no change of its own. */
export function keepsLabel(before: string, after: string, git: ReviewedGit): boolean {
  try {
    const [first, second, ...rest] = git.parents(after);
    if (first !== before || second === undefined || rest.length > 0) return false;
    if (!git.onMain(second)) return false;
    const merged = git.mergedTree(before, second);
    return merged !== undefined && merged === git.tree(after);
  } catch {
    return false;
  }
}

/** How many clean commits the walk follows before it gives up; a branch merges main about once a day. */
const MAX_CLEAN_COMMITS = 50;

/**
 * True when `head` is `base`, or follows it by clean commits only: merges of main, each one a push `keepsLabel` would
 * keep the label on (RP-1017: `pnpm queue` and the verify gate take a `pnpm verify` run on such an older head), and
 * the screenshot bot's baseline-only commits (`isBaselineBotCommit`, RP-1103). `base` may be abbreviated. The
 * `reviewed` label takes one step per push (`dropLabelOnPush`), and a bot commit only when a bot pushed it (RP-1121).
 */
export function onlyCleanCommitsSince(base: string, head: string, git: ReviewedGit): boolean {
  return cleanWalk(base, head, git).clean;
}

/**
 * The walk `onlyCleanCommitsSince` takes, from `head` down first parents to `base`: `clean` when it gets there by clean
 * commits only; otherwise `stoppedAt`, the newest commit that is not one, or undefined when git could not be read or the
 * walk ran past `MAX_CLEAN_COMMITS`. `pnpm queue` names that commit up front when it is a merge of main (RP-1113).
 */
export function cleanWalk(base: string, head: string, git: ReviewedGit): { clean: true } | { clean: false; stoppedAt: string | undefined } {
  let current = head;
  for (let steps = 0; steps <= MAX_CLEAN_COMMITS; steps++) {
    if (current.startsWith(base)) return { clean: true };
    let first: string | undefined;
    try {
      first = git.parents(current)[0];
    } catch {
      return { clean: false, stoppedAt: undefined };
    }
    if (first === undefined || !(keepsLabel(first, current, git) || isBaselineBotCommit(current, git))) return { clean: false, stoppedAt: current };
    current = first;
  }
  return { clean: false, stoppedAt: undefined };
}

/** True when `commit` merges main in: two parents, the second on origin/main. Whether it is clean is `keepsLabel`'s. */
export function isMergeOfMain(commit: string, git: ReviewedGit): boolean {
  try {
    const [, second, ...rest] = git.parents(commit);
    return second !== undefined && rest.length === 0 && git.onMain(second);
  } catch {
    return false;
  }
}

/** True when `after` is one baseline-only bot commit (`isBaselineBotCommit`) straight on top of `before` (RP-1121). */
export function baselineBotPush(before: string, after: string, git: ReviewedGit): boolean {
  try {
    return git.parents(after)[0] === before && isBaselineBotCommit(after, git);
  } catch {
    return false;
  }
}

export interface ReviewedGitHub {
  removeLabel(pr: number): Promise<void>;
}

/**
 * Returns what was done, for the log. `pushedByBot`: the push's sender is a bot account (`sender.type` "Bot"), as the
 * screenshot workflow's App is. Lanes push as people, so a commit that only claims the bot's email drops the label.
 */
export async function dropLabelOnPush(
  event: { pr: number; action: string; labels: string[]; before?: string | undefined; after?: string | undefined; pushedByBot?: boolean },
  git: ReviewedGit,
  github: ReviewedGitHub,
): Promise<string> {
  if (!event.labels.includes(REVIEWED_LABEL)) return `PR #${event.pr} has no \`${REVIEWED_LABEL}\` label: nothing to remove.`;
  // Only a push (synchronize) has a reviewed head before it; opened and reopened never keep the label.
  if (event.action === "synchronize" && event.before && event.after) {
    if (keepsLabel(event.before, event.after, git)) return `PR #${event.pr}: the push only merged main in by a clean merge; \`${REVIEWED_LABEL}\` stays.`;
    if (event.pushedByBot && baselineBotPush(event.before, event.after, git)) {
      return `PR #${event.pr}: the push only added the screenshot bot's baseline commit; \`${REVIEWED_LABEL}\` stays.`;
    }
  }
  await github.removeLabel(event.pr);
  const why = event.action === "synchronize" ? "the new push" : `the ${event.action} PR's head`;
  return `PR #${event.pr}: removed \`${REVIEWED_LABEL}\`; ${why} needs a /code-review again, posted with scripts/review-post.ts, and a stamped verify line for it in the body: CI's reviewed-add then adds the label (a hand label does not count, RP-1167).`;
}

export function realGit(cwd: string = process.cwd(), spawn: typeof spawnSync = spawnSync): ReviewedGit {
  const run = (args: string[]) => spawn("git", args, { cwd, encoding: "utf8" });
  const must = (args: string[]) => {
    const done = run(args);
    if (done.status !== 0) throw new Error(`git ${args.slice(0, 2).join(" ")} failed:\n${done.stdout ?? ""}${done.stderr ?? ""}`);
    return (done.stdout ?? "").trim();
  };
  return {
    parents: (commit) => must(["rev-list", "--parents", "-n", "1", commit]).split(" ").slice(1),
    onMain: (commit) => run(["merge-base", "--is-ancestor", commit, "origin/main"]).status === 0,
    tree: (commit) => must(["rev-parse", `${commit}^{tree}`]),
    mergedTree(base, other) {
      const done = run(["merge-tree", "--write-tree", base, other]);
      return done.status === 0 ? (done.stdout ?? "").split("\n")[0]?.trim() : undefined;
    },
    identity(commit) {
      const [author = "", committer = ""] = must(["log", "-1", "--format=%ae%n%ce", commit]).split("\n");
      return { author: author.trim(), committer: committer.trim() };
    },
    changedPaths: (commit) =>
      must(["diff-tree", "--no-commit-id", "--name-only", "-r", "--no-renames", commit])
        .split("\n")
        .map((path) => path.trim())
        .filter(Boolean),
  };
}

function overHttp(repository: string, token: string): ReviewedGitHub {
  return {
    async removeLabel(pr) {
      const response = await fetch(`https://api.github.com/repos/${repository}/issues/${pr}/labels/${REVIEWED_LABEL}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      });
      // 404: the label was already removed (or never existed), which is the goal.
      if (!response.ok && response.status !== 404) throw new Error(`GitHub DELETE label answered ${response.status}`);
    },
  };
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY must be set");
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8")) as {
    action: string;
    pull_request: { number: number; labels: { name: string }[] };
    before?: string;
    after?: string;
    sender?: { type?: string };
  };
  const summary = await dropLabelOnPush(
    {
      pr: event.pull_request.number,
      action: event.action,
      labels: event.pull_request.labels.map((label) => label.name),
      before: event.before,
      after: event.after,
      pushedByBot: event.sender?.type === "Bot",
    },
    realGit(),
    overHttp(repository, token),
  );
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
