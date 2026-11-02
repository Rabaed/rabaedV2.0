/* eslint-disable rabaed/no-avoid-terms -- GitHub's merge queue, its user types and actors, by their own names */
// RP-1195 item 2: `node scripts/pr-status.ts <n> [<n>...]` says, per PR, everything the merge gate reads: the head,
// the stamp or CI-green verdict, the review markers, who added or took off `reviewed` (CI's bot or a person), auto-merge
// now and its history, the implement marker and the queue position. It only reads (gh with --json or
// `gh api --paginate --slurp`, never jq) and exits 0; a read that fails becomes a warning. `prStatus` returns the data
// so `review:pr` (item 5) can print the same timeline.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { formatPrStatus } from "./pr-status-lines.ts";
import { implementKeys } from "./review-post.ts";
import { readEvents, readQueue, realGh, type Gh } from "./orch-status.ts";
import { reviewedText, type OpenPr, type QueueEntry } from "./orch-status-lines.ts";
import { isTrustedAuthor, reviewAt, reviewMarker, type ReviewFound } from "./reviewed-add.ts";
import { onlyCleanCommitsSince, REVIEWED_LABEL } from "./reviewed-label.ts";
import { DOCS_ONLY_LABEL, enteredQueueByAutoMerge, REVIEWED_ADD_ACTOR, type PrEvent } from "./reviewed-required.ts";
import { ciEvidenceOf, ciJobsPath, ciOwnChanges, ciRunFrom, ciRunsPath, requiredFromRules, RULES_PATH, runsFrom, type CiEvidence } from "./ci-green.ts";
import { markerWriters, needsVerify, realGateGit, verifiedBy, verifiedCommits, verifiedOrGreen, type Permission, type ReviewComment } from "./verify-gate.ts";

/** The git reads: the gate's, plus `git fetch origin main` so origin/main is current. */
export type PrGit = ReturnType<typeof realGateGit> & { fetchMain(): void };

export interface PrStatusSeam {
  gh: Gh;
  git: PrGit;
}

export interface PrReport {
  pr: number;
  head?: string;
  branch?: string;
  draft?: boolean;
  state?: string;
  /** The Jira key of the body's `<!-- implement: RP-nnn -->`, undefined when missing. */
  implement?: string;
  /** The merge queue entry, undefined when not queued (or unread: see warnings). */
  queue?: { position: number; state: string };
  /** Auto-merge now: who turned it on and when. */
  autoMerge?: { on: boolean; by?: string; at?: string };
  /** Whether auto-merge did the PR's last queue entry (`enteredQueueByAutoMerge`); undefined when it never entered. */
  enteredByAutoMerge?: boolean;
  /** `reviewedText`: whether the `reviewed` label counts, and why not. */
  reviewed?: string;
  /** The verify gate: what it passes on, or why it does not; undefined when unread. */
  gate?: { ok: true; by: string } | { ok: false; reason: string };
  /** The shas the body's stamped verify lines name. */
  stamped?: string[];
  /** Every review marker on the PR: the sha it names, who posted it, and whether reviewed-add would count it for the head. */
  markers: { sha: string; login: string; bot: boolean; at: string; counts: boolean }[];
  /** reviewed-add's decision (`reviewAt`): the commit whose marker counts, or why none does; undefined when unread. */
  review?: ReviewFound;
  /** The gate's events and the review markers, oldest first. */
  timeline: TimelineItem[];
  warnings: string[];
}

/** One thing that happened to the PR: `bot` for a GitHub App's login, else a person (every session acts as the owner's login). */
export interface TimelineItem {
  at: string;
  actor: string;
  bot: boolean;
  event: string;
}

interface Pull {
  number: number;
  headRefName: string;
  headRefOid: string;
  isDraft?: boolean;
  state?: string;
  labels?: { name: string }[];
  autoMergeRequest?: { enabledBy?: { login?: string }; enabledAt?: string } | null;
  body?: string;
}

const PULL_FIELDS = "number,headRefName,headRefOid,isDraft,labels,autoMergeRequest,body,state";

const reason = (error: unknown) => ((error as { stderr?: string }).stderr || (error as Error).message || String(error)).split("\n")[0]!.trim();

/** Everything about PR `n`; `queue` is the merge queue when the caller read it already. */
export function prStatus(seam: PrStatusSeam, n: number, queue?: QueueEntry[]): PrReport {
  const report: PrReport = { pr: n, markers: [], timeline: [], warnings: [] };
  let pull: Pull;
  try {
    pull = JSON.parse(seam.gh(["pr", "view", String(n), "--json", PULL_FIELDS])) as Pull;
  } catch (error) {
    report.warnings.push(`gh could not read PR ${n} (${reason(error)}).`);
    return report;
  }
  report.head = pull.headRefOid;
  report.branch = pull.headRefName;
  report.draft = pull.isDraft ?? false;
  report.state = pull.state;
  // review-post.ts's reading: a marker on a line of its own, outside fenced blocks (RP-1195 review).
  report.implement = implementKeys(pull.body ?? "")[0];
  const auto = pull.autoMergeRequest;
  report.autoMerge = auto ? { on: true, by: auto.enabledBy?.login, at: auto.enabledAt } : { on: false };
  try {
    const entry = (queue ?? readQueue(seam.gh)).find((q) => q.pr === n);
    if (entry) report.queue = { position: entry.position, state: entry.state };
  } catch (error) {
    report.warnings.push(`the merge queue could not be read (${reason(error)}).`);
  }
  let events: PrEvent[] | undefined;
  try {
    events = readEvents(seam.gh, n);
  } catch (error) {
    report.warnings.push(`the PR's events could not be read (${reason(error)}).`);
  }
  report.reviewed = reviewedText(pull as OpenPr, events);
  ({ gate: report.gate, stamped: report.stamped } = readGate(seam, pull));
  const marks = readMarkers(seam, n, pull.headRefOid);
  report.markers = marks.markers;
  report.review = marks.review;
  report.warnings.push(...marks.warnings);
  report.timeline.push(...marks.markers.map((m) => ({ at: m.at, actor: m.login, bot: m.bot, event: `posted the review marker for ${m.sha.slice(0, 7)}` })));
  if (events) {
    report.enteredByAutoMerge = events.some((e) => e.event === "added_to_merge_queue") ? enteredQueueByAutoMerge(events) : undefined;
    report.timeline.push(...events.flatMap(eventItem));
  }
  report.timeline.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return report;
}

/** CI's evidence for `head` over gh, as `pnpm queue` reads it but with --slurp and JSON.parse instead of --jq. */
const ciEvidence = (gh: Gh, head: string): CiEvidence =>
  ciEvidenceOf(() => {
    const api = (path: string) => JSON.parse(gh(["api", `repos/{owner}/{repo}/${path}`])) as unknown;
    const required = requiredFromRules((JSON.parse(gh(["api", "--paginate", "--slurp", `repos/{owner}/{repo}/${RULES_PATH}`])) as unknown[][]).flat());
    return { required, runs: runsFrom(api(ciRunsPath(head))).map((run) => ciRunFrom(run, api(ciJobsPath(run.id)))) };
  });

/** The verify gate's verdict (`verifiedOrGreen`, the docs-only pass as verify-gate.ts has it) and the stamped shas. */
function readGate(seam: PrStatusSeam, pull: Pull): { gate: NonNullable<PrReport["gate"]>; stamped: string[] } {
  const head = pull.headRefOid;
  const body = pull.body ?? "";
  const stamped = verifiedCommits(body);
  let changed: string[];
  let ownChanges: string[];
  try {
    seam.git.fetchMain();
    seam.git.fetchPull(pull.number);
    changed = seam.git.changedFiles(head);
    ownChanges = ciOwnChanges(changed, (file) => seam.git.packageJsonVersions(head, file));
  } catch (error) {
    return { gate: { ok: false, reason: `could not read the head's changes (${reason(error)})` }, stamped };
  }
  const labels = (pull.labels ?? []).map((l) => l.name);
  if (!needsVerify(labels, changed) && ownChanges.length === 0) return { gate: { ok: true, by: `${DOCS_ONLY_LABEL}: no verify run needed` }, stamped };
  const verdict = verifiedOrGreen(body, head, pull.number, seam.git, ownChanges, ciEvidence(seam.gh, head));
  return { gate: verdict.ok ? { ok: true, by: verifiedBy(verdict) } : { ok: false, reason: verdict.reason }, stamped };
}

// reviewed-add.ts keeps its pattern private; this one is built the same way from `reviewMarker` (RP-1195 item 2).
const MARKER = new RegExp(reviewMarker("([0-9a-f]{40})"), "g");

/** The review markers (`node scripts/review-post.ts`) and reviewed-add's decision on them, as reviewed-add reads them. */
function readMarkers(seam: PrStatusSeam, n: number, head: string): { markers: PrReport["markers"]; review?: ReviewFound; warnings: string[] } {
  let comments: (ReviewComment & { at: string })[];
  try {
    const raw = JSON.parse(seam.gh(["api", `repos/{owner}/{repo}/issues/${n}/comments?per_page=100`, "--paginate", "--slurp"])) as { user?: { login: string; type: string } | null; body?: string | null; created_at: string }[][];
    comments = raw.flat().map((c) => ({ login: c.user?.login ?? "", type: c.user?.type ?? "", body: c.body ?? "", at: c.created_at }));
  } catch (error) {
    return { markers: [], warnings: [`the PR's comments could not be read, so the review markers are unknown (${reason(error)}).`] };
  }
  const warnings: string[] = [];
  const marked = comments.flatMap((c) => [...c.body.matchAll(MARKER)].map(([, sha = ""]) => ({ comment: c, sha })));
  let writers: Set<string>;
  try {
    writers = markerWriters(comments, (c) => marked.some((m) => m.comment === c), (login) => (JSON.parse(seam.gh(["api", `repos/{owner}/{repo}/collaborators/${encodeURIComponent(login)}/permission`])) as { permission: Permission }).permission);
  } catch (error) {
    warnings.push(`who may write a review marker could not be read (${reason(error)}).`);
    writers = new Set();
  }
  const clean = (sha: string) => {
    try {
      return onlyCleanCommitsSince(sha, head, seam.git);
    } catch {
      return false;
    }
  };
  const markers = marked.map(({ comment, sha }) => ({ sha, login: comment.login, bot: isBot(comment.login, comment.type), at: comment.at, counts: isTrustedAuthor(comment, writers) && clean(sha) }));
  return { markers, review: reviewAt(comments, head, seam.git, writers), warnings };
}

/**
 * True for a GitHub App (CI's reviewed-add, the merge queue): its login ends in `[bot]`, or GitHub types it `Bot`. One
 * test for comments and events alike (an event carries only the login). hand-action-comment.ts keeps its own copy: it
 * imports built-ins only.
 */
const isBot = (login: string, type?: string) => login === REVIEWED_ADD_ACTOR || login.endsWith("[bot]") || type === "Bot";

/** The timeline line of an issue event the gate reads; none for the others. */
function eventItem(e: PrEvent): TimelineItem[] {
  const bot = isBot(e.actor);
  let text: string | undefined;
  if (e.label === REVIEWED_LABEL && e.event === "labeled") text = e.actor === REVIEWED_ADD_ACTOR ? "added `reviewed`" : "added `reviewed` by hand (does not count)";
  else if (e.label === REVIEWED_LABEL && e.event === "unlabeled") text = "took `reviewed` off";
  else text = EVENT_TEXT[e.event];
  return text === undefined ? [] : [{ at: e.createdAt, actor: e.actor, bot, event: text }];
}

const EVENT_TEXT: Record<string, string> = {
  auto_merge_enabled: "turned auto-merge on",
  auto_merge_disabled: "turned auto-merge off",
  added_to_merge_queue: "entered the merge queue",
  removed_from_merge_queue: "left the merge queue",
};

const USAGE = "Usage: node scripts/pr-status.ts <pr number> [<pr number>...]";

/** The CLI: a block per PR, the merge queue read once; exit 1 only on bad arguments (it only reads). */
export function prStatusMain(args: string[], seam: PrStatusSeam): { code: number; lines: string[] } {
  if (args.length === 0 || !args.every((a) => /^[1-9]\d*$/.test(a))) return { code: 1, lines: [USAGE] };
  let queue: QueueEntry[] | undefined;
  try {
    queue = readQueue(seam.gh);
  } catch {
    // Each PR reads it again and warns.
  }
  return { code: 0, lines: args.flatMap((a) => formatPrStatus(prStatus(seam, Number(a), queue))) };
}

export function realSeam(cwd: string = process.cwd(), spawn: typeof spawnSync = spawnSync): PrStatusSeam {
  const git = realGateGit(cwd, spawn);
  return {
    gh: realGh,
    git: {
      ...git,
      fetchMain: () => {
        const done = spawn("git", ["fetch", "--no-tags", "origin", "main"], { cwd, encoding: "utf8" });
        if (done.status !== 0) throw new Error(`git fetch origin main failed:\n${done.stdout ?? ""}${done.stderr ?? ""}`);
      },
    },
  };
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  const { code, lines } = prStatusMain(process.argv.slice(2), realSeam());
  for (const line of lines) (code === 0 ? console.log : console.error)(line);
  process.exit(code);
}
