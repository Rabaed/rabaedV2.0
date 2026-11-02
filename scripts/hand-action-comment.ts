/* eslint-disable rabaed/no-avoid-terms -- GitHub's names (User, Bot, the merge queue, Actions) and the HTML-comment markers, as in reviewed-add.ts */
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Comments on a pull request when a person does by hand what `pnpm queue` does (RP-1195 item 3): adds the
// `reviewed` label, turns auto-merge on, or puts it in the merge queue. Run by
// .github/workflows/hand-action-comment.yml on pull_request_target: labeled, auto_merge_enabled, enqueued.
// The comment is what wakes the session's Auto-fix; the action itself shows only in the PR's timeline.
//
// Environment: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_NAME, GITHUB_EVENT_PATH. Reads the PR's comments
// and posts one; runs no PR code. Imports builtins only, so it adds nothing to CI's own files but itself.

export interface Payload {
  action?: string;
  label?: { name?: string };
  pull_request: { number: number; head: { sha: string; repo?: { full_name?: string } | null }; auto_merge?: unknown };
  repository?: { full_name?: string };
  sender: { login: string; type?: string };
}

export interface PrComment {
  body?: string | null;
  user?: { login?: string; type?: string } | null;
  author_association?: string;
}

/** What the script reads besides the event: the PR's comments. */
export interface Facts {
  comments: readonly PrComment[];
}

export type HandKind = "reviewed" | "auto-merge" | "queue";

export interface HandAction {
  kind: HandKind;
  actor: string;
  pr: number;
  head: string;
  /** False for a queue entry with auto-merge off: Reviewed required passes it, it only skips `pnpm queue`'s checks. */
  failsReviewedRequired: boolean;
}

/** reviewed-add.yml's login (reviewed-required.ts REVIEWED_ADD_ACTOR; inlined: this script imports nothing local). */
const REVIEWED_ADD_ACTOR = "github-actions[bot]";

const isBot = (sender: Payload["sender"]) => sender.type === "Bot" || sender.login.endsWith("[bot]") || sender.login === REVIEWED_ADD_ACTOR;

// `pnpm queue`'s marker, the same text as scripts/queue-marker.ts's pnpmQueueMarker(sha) (RP-1195, built in
// parallel); join the two once both are on main.
const pnpmQueueMarker = (sha: string) => `<!-- pnpm-queue: ${sha} -->`;
/** Who can run `pnpm queue` here: the comment's author has access to the repository. */
const WRITERS = ["OWNER", "MEMBER", "COLLABORATOR"];
const queuedByPnpm = (comments: readonly PrComment[], head: string) =>
  comments.some((comment) => comment.user?.type === "User" && WRITERS.includes(comment.author_association ?? "") && (comment.body ?? "").includes(pnpmQueueMarker(head)));

/** The hand action an event reports, or undefined when there is nothing to say. */
export function handAction(event: string, payload: Payload, facts: Facts): HandAction | undefined {
  if (event !== "pull_request_target") return undefined;
  const { pull_request: pr, sender } = payload;
  // A fork's PR is not a lane's: nobody runs `pnpm queue` for it.
  const repository = payload.repository?.full_name;
  if (repository === undefined || pr.head.repo?.full_name !== repository) return undefined;
  const base = { actor: sender.login, pr: pr.number, head: pr.head.sha };
  if (payload.action === "labeled" && payload.label?.name === "reviewed") {
    return isBot(sender) ? undefined : { kind: "reviewed", ...base, failsReviewedRequired: true };
  }
  // Reviewed required fails while auto-merge is on (it reads auto_merge.enabled_by).
  if (payload.action === "auto_merge_enabled") return { kind: "auto-merge", ...base, failsReviewedRequired: true };
  if (payload.action === "enqueued" && !queuedByPnpm(facts.comments, pr.head.sha)) {
    // With auto-merge off, Reviewed required passes a button entry: it only skips `pnpm queue`'s checks.
    return { kind: "queue", ...base, failsReviewedRequired: pr.auto_merge != null };
  }
  return undefined;
}

/** A login inside a code span; GitHub logins hold no backtick, but the text is the event's. */
const login = (actor: string) => actor.replace(/[^\w.[\]-]/g, "");

/** One comment per action: the marker names the action, the person and the head. */
export const handActionMarker = (action: HandAction) => `<!-- hand-action: ${action.kind} ${login(action.actor)} ${action.head} -->`;

export function handActionComment(action: HandAction): string {
  const who = `\`${login(action.actor)}\``;
  const queue = `\`pnpm queue ${action.pr}\``;
  const verdict = action.failsReviewedRequired ? "this fails Reviewed required" : "this skips `pnpm queue`'s checks";
  const text = {
    reviewed: `${who} added the \`reviewed\` label by hand: ${verdict}. Remove it (\`gh pr edit ${action.pr} --remove-label reviewed\`) and run ${queue}.`,
    "auto-merge": `${who} turned auto-merge on: ${verdict}. Turn it off (\`gh pr merge ${action.pr} --disable-auto\`) and run ${queue}.`,
    queue: `${who} put this PR in the merge queue without \`pnpm queue\`: ${verdict}. Remove it from the queue and run ${queue}.`,
  }[action.kind];
  return `${handActionMarker(action)}\n${text}`;
}

/** What the script reads and writes on GitHub; overHttp is the real one, tests fake it. */
export interface HandActionGitHub {
  comments(pr: number): Promise<PrComment[]>;
  postComment(pr: number, body: string): Promise<void>;
}

/**
 * Posts the comment for a hand action and returns its body, or returns undefined: nothing to say, or this
 * action's comment is already there. Only the workflow's own comments count, so a typed marker cannot silence it.
 */
export async function commentOnHandAction(event: string, payload: Payload, github: HandActionGitHub): Promise<string | undefined> {
  const comments = await github.comments(payload.pull_request.number);
  const action = handAction(event, payload, { comments });
  if (action === undefined) return undefined;
  const marker = handActionMarker(action);
  if (comments.some((comment) => comment.user?.login === REVIEWED_ADD_ACTOR && (comment.body ?? "").includes(marker))) return undefined;
  const body = handActionComment(action);
  await github.postComment(action.pr, body);
  return body;
}

export function overHttp(repository: string, token: string, fetcher: typeof fetch = fetch): HandActionGitHub {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const api = async (path: string, init?: RequestInit) => {
    const response = await fetcher(`https://api.github.com/${path}`, { ...init, headers });
    if (!response.ok) throw new Error(`GitHub ${init?.method ?? "GET"} ${path} answered ${response.status}`);
    return response;
  };
  return {
    async comments(pr) {
      const all: PrComment[] = [];
      for (let page = 1; ; page++) {
        const batch = (await (await api(`repos/${repository}/issues/${pr}/comments?per_page=100&page=${page}`)).json()) as PrComment[];
        all.push(...batch);
        if (batch.length < 100) return all;
      }
    },
    async postComment(pr, body) {
      await api(`repos/${repository}/issues/${pr}/comments`, { method: "POST", body: JSON.stringify({ body }) });
    },
  };
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY must be set");
  const payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8")) as Payload;
  const body = await commentOnHandAction(process.env.GITHUB_EVENT_NAME ?? "", payload, overHttp(repository, token));
  const summary = body ?? "Nothing to post: no hand action, or its comment is already there.";
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
