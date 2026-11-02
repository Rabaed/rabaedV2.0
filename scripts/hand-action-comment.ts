/* eslint-disable rabaed/no-avoid-terms -- GitHub's names (User, Bot, the merge queue, Actions) and the HTML-comment markers, as in reviewed-add.ts */
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Comments on a pull request when a person does by hand what `pnpm queue` does (RP-1195 item 3): adds the
// `reviewed` label, turns auto-merge on, or puts it in the merge queue. Run by
// .github/workflows/hand-action-comment.yml on pull_request_target: labeled, auto_merge_enabled, enqueued.
// The comment is what wakes the session's Auto-fix; the action itself shows only in the PR's timeline.
//
// Environment: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_NAME, GITHUB_EVENT_PATH. Reads the PR's comments
// (and, for a queue entry, its issue events) and posts one; runs no PR code. Imports builtins only, so it adds nothing to CI's own files but itself.

export interface Payload {
  action?: string;
  label?: { name?: string };
  /** `updated_at` is the nearest the `enqueued` payload has to the entry's time: it carries no time of its own. */
  pull_request: { number: number; head: { sha: string; repo?: { full_name?: string } | null }; auto_merge?: unknown; updated_at?: string };
  repository?: { full_name?: string };
  sender: { login: string; type?: string };
}

export interface PrComment {
  body?: string | null;
  user?: { login?: string; type?: string } | null;
  author_association?: string;
  created_at?: string;
}

/** One of the PR's issue events (`repos/<repo>/issues/<n>/events`): `added_to_merge_queue`, `removed_from_merge_queue`, … */
export interface IssueEvent {
  event?: string;
  created_at?: string;
}

/**
 * What the script reads besides the event: the PR's comments, its issue events (undefined when they could not be
 * read: then no `pnpm queue` marker counts), and the time it runs (for a payload with no time).
 */
export interface Facts {
  comments: readonly PrComment[];
  events?: readonly IssueEvent[];
  now?: Date;
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

// `pnpm queue`'s marker. scripts/queue-marker.ts builds it (pnpmQueueMarker); this is a copy, because this script
// imports built-ins only (it is one of CI's own files, and stays the only one this workflow adds). The two must change
// together: hand-action-comment.test.ts checks this matches what queue-marker.ts builds.
const pnpmQueueMarker = (sha: string) => `<!-- pnpm-queue: ${sha} -->`;
/** Who can run `pnpm queue` here: the comment's author has access to the repository. */
const WRITERS = ["OWNER", "MEMBER", "COLLABORATOR"];

/**
 * Whether `pnpm queue` made the entry at `at`: the newest marker for the head, by a person with access, was posted at or
 * before it (RP-1195 review). A marker posted later belongs to a later run; `pnpm queue` takes off one whose enqueue failed.
 * A marker whose entry left the queue (a removal after it, at or before `at`) no longer counts: a button re-entry of the
 * same head is a hand action (RP-1195 follow-up). Unknown events count no marker.
 */
function queuedByPnpm(facts: Facts, head: string, at: number): boolean {
  const times = facts.comments
    .filter((comment) => comment.user?.type === "User" && WRITERS.includes(comment.author_association ?? "") && (comment.body ?? "").includes(pnpmQueueMarker(head)))
    .map((comment) => Date.parse(comment.created_at ?? ""));
  if (facts.events === undefined || times.length === 0 || times.some(Number.isNaN)) return false;
  const marked = Math.max(...times);
  if (marked > at) return false;
  const left = facts.events.filter((each) => each.event === "removed_from_merge_queue").map((each) => Date.parse(each.created_at ?? ""));
  // An unreadable time could fall anywhere: count it as a removal.
  return !left.some((time) => Number.isNaN(time) || (time > marked && time <= at));
}

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
  const at = Date.parse(pr.updated_at ?? "");
  if (payload.action === "enqueued" && !queuedByPnpm(facts, pr.head.sha, Number.isNaN(at) ? (facts.now ?? new Date()).getTime() : at)) {
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
  /** The PR's issue events; GITHUB_TOKEN's `pull-requests: read` (or `issues: read`) reads them. */
  events(pr: number): Promise<IssueEvent[]>;
  postComment(pr: number, body: string): Promise<void>;
}

/**
 * Posts the comment for a hand action and returns its body, or returns undefined: nothing to say, or this
 * action's comment is already there. Only the workflow's own comments count, so a typed marker cannot silence it.
 */
export async function commentOnHandAction(event: string, payload: Payload, github: HandActionGitHub): Promise<string | undefined> {
  const comments = await github.comments(payload.pull_request.number);
  // Only a queue entry needs the events; unread, no marker counts, so the comment is posted (RP-1195 follow-up).
  const events = payload.action === "enqueued" ? await github.events(payload.pull_request.number).catch(() => undefined) : undefined;
  const action = handAction(event, payload, { comments, events });
  if (action === undefined) return undefined;
  const own = comments.filter((comment) => comment.user?.login === REVIEWED_ADD_ACTOR).map((comment) => comment.body ?? "");
  if (own.some((body) => body.includes(handActionMarker(action)))) return undefined;
  // An entry auto-merge made follows the auto-merge comment for this head, which already says what to undo (RP-1195 review).
  const autoMerged = new RegExp(`<!-- hand-action: auto-merge \\S+ ${action.head} -->`);
  if (action.kind === "queue" && payload.pull_request.auto_merge != null && own.some((body) => autoMerged.test(body))) return undefined;
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
  const pages = async <T>(path: string) => {
    const all: T[] = [];
    for (let page = 1; ; page++) {
      const batch = (await (await api(`${path}?per_page=100&page=${page}`)).json()) as T[];
      all.push(...batch);
      if (batch.length < 100) return all;
    }
  };
  return {
    comments: (pr) => pages<PrComment>(`repos/${repository}/issues/${pr}/comments`),
    events: (pr) => pages<IssueEvent>(`repos/${repository}/issues/${pr}/events`),
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
