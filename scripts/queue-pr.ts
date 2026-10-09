import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { classify, type RemovalKind } from "./queue-drop-comment.ts";

// `pnpm queue <pr>` (RP-400, from the PR #149 retro): checks the branch against
// today's origin/main, then queues the PR. A PR whose CI went green hours ago
// can have lost to a newer main (a migration with the same timestamp, a text
// conflict); the queue removes it for that, and every re-queue costs a full run.
//
// Run it from any checkout, as one plain command: `pnpm queue 149 --wait` (RP-454).
// The checks and the queue entry use the PR's own head (refs/pull/<n>/head), not
// HEAD. --wait polls every 60 s until the PR merges (exit 0) or leaves the queue
// or closes (exit 1, with the reason).
// The git and gh calls sit behind QueueSeam so the tests touch no network.

export interface PullStatus {
  state: "OPEN" | "MERGED" | "CLOSED";
  isInMergeQueue: boolean;
}

export interface QueueSeam {
  /** `git fetch origin main`; false when it fails. */
  fetchMain(): boolean;
  /** Fetches `refs/pull/<pr>/head` (the PR's own head, whatever is checked out) and returns its commit. */
  fetchPull(pr: number): string;
  /** The commit HEAD points at. */
  head(): string;
  /** True when `ancestor` is a strict ancestor of `commit` (HEAD is on the PR's branch but behind it). */
  isBehind(ancestor: string, commit: string): boolean;
  /** `gh pr view <pr> --json id,headRefOid` */
  pullRequest(pr: number): { id: string; headRefOid: string };
  /** `git merge-tree --write-tree origin/main <commit>`: status 0 when it merges cleanly, 1 when it conflicts, anything else is an error. */
  mergeTree(commit: string): { status: number; output: string; stderr: string };
  /** The migration checks of `commit` against origin/main; status 0 when they pass. */
  check(name: "drift" | "immutable", commit: string): { status: number; output: string };
  /** The `enqueuePullRequest` mutation, pinned by expectedHeadOid. */
  enqueue(id: string, head: string): { position: number; state: string };
  /** The PR's `state` and `isInMergeQueue` (GraphQL; `gh pr view` has no such field). */
  status(id: string): PullStatus;
  /** The reason of the PR's latest RemovedFromMergeQueueEvent (an enum, e.g. MERGE_CONFLICT); undefined when there is none. */
  removalReason(id: string): string | undefined;
}

export interface QueueResult {
  ok: boolean;
  lines: string[];
}

const fail = (...lines: string[]): QueueResult => ({ ok: false, lines });

/** Paths in `git merge-tree` output's conflicted-file list ("<mode> <oid> <stage>\t<path>"). */
export function conflictedFiles(output: string): string[] {
  const paths = new Set<string>();
  for (const line of output.split("\n")) {
    const match = /^\d+ [0-9a-f]+ [123]\t(.+)$/.exec(line);
    if (match?.[1]) paths.add(match[1]);
  }
  return [...paths];
}

export function queuePr(pr: number, seam: QueueSeam): QueueResult {
  if (!seam.fetchMain()) return fail("git fetch origin main failed; the checks need a current origin/main. Get online and run `pnpm queue` again.");

  // The checks run on the PR's own head, fetched from refs/pull/<n>/head, so any checkout can queue any PR.
  const pull = seam.pullRequest(pr);
  const head = seam.fetchPull(pr);
  if (head !== pull.headRefOid) {
    return fail(
      `PR #${pr}'s head moved while fetching: the API says ${pull.headRefOid}, the fetched ref is ${head}, so these checks would not be about what gets queued.`,
      "Fix: wait a moment for GitHub to settle, then run `pnpm queue` again.",
    );
  }
  const warnings: string[] = [];
  const checkout = seam.head();
  if (checkout !== head && seam.isBehind(checkout, head)) {
    warnings.push(`Warning: HEAD (${checkout}) is behind PR #${pr}'s head (${head}); checked and queued the PR's head. Pull to catch up.`);
  }

  const merge = seam.mergeTree(head);
  if (merge.status > 1 || merge.status < 0) {
    return fail(
      `git merge-tree failed with exit ${merge.status}; this is not a conflict:`,
      merge.stderr.trimEnd() || "(no stderr)",
      "Fix: check that origin/main was fetched and this worktree is a clean checkout of the PR branch, then run `pnpm queue` again.",
    );
  }
  if (merge.status === 1) {
    const files = conflictedFiles(merge.output);
    return fail(
      `PR #${pr} conflicts with origin/main in ${files.length} file(s):`,
      ...files.map((file) => `  ${file}`),
      "Fix: merge main into the branch, resolve the conflicts, push, wait for CI, then run `pnpm queue` again.",
    );
  }

  const drift = seam.check("drift", head);
  if (drift.status !== 0) {
    return fail(drift.output.trimEnd(), "Fix: merge main, rename the migration so it sorts after main's latest, push, wait for CI, then run `pnpm queue` again.");
  }
  const immutable = seam.check("immutable", head);
  if (immutable.status !== 0) {
    return fail(immutable.output.trimEnd(), "Fix: merge main, rename the migration so it sorts after main's latest (an existing migration is never edited), push, wait for CI, then run `pnpm queue` again.");
  }

  const entry = seam.enqueue(pull.id, head);
  return { ok: true, lines: [...warnings, `Queued PR #${pr} at ${head}: position ${entry.position}, state ${entry.state}.`] };
}

const POLL_MS = 60_000;

const REMOVAL_TEXT: Record<RemovalKind, string> = {
  failed: "a check failed in the queue's CI run (the PR's own checks can still be green): read the queue run's failing job, merge main, fix it, push",
  conflict: "it conflicts with main or a PR ahead of it: merge main, resolve the conflicts, push",
  merged: "it was already merged",
  manual: "a person removed it on purpose",
  other: "open the PR timeline for the reason",
};

/** Polls (GraphQL `state`, `isInMergeQueue`) until the PR merges (ok) or leaves the queue or closes (not ok, with the reason). */
export async function waitForMerge(pr: number, seam: QueueSeam, sleep: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms))): Promise<QueueResult> {
  const { id } = seam.pullRequest(pr);
  let outside = 0;
  for (;;) {
    const { state, isInMergeQueue } = seam.status(id);
    if (state === "MERGED") return { ok: true, lines: [`PR #${pr} merged.`] };
    if (state === "CLOSED") return fail(`PR #${pr} was closed without merging.`);
    // One poll outside the queue can be the merge landing; two in a row is a removal.
    outside = isInMergeQueue ? 0 : outside + 1;
    if (outside >= 2) {
      const reason = seam.removalReason(id) ?? "unknown";
      return fail(`PR #${pr} left the merge queue (reason: ${reason}): ${REMOVAL_TEXT[classify(reason)]}, then run \`pnpm queue ${pr} --wait\` again.`);
    }
    await sleep(POLL_MS);
  }
}

const mutation = "mutation($id: ID!, $head: GitObjectID!) { enqueuePullRequest(input: {pullRequestId: $id, expectedHeadOid: $head}) { mergeQueueEntry { position state } } }";

/** The real git and gh calls. No shell is involved, so the caller needs no quoting tricks. */
export function realSeam(cwd: string = process.cwd(), spawn: typeof spawnSync = spawnSync): QueueSeam {
  const run = (command: string, args: string[]) => {
    const done = spawn(command, args, { cwd, encoding: "utf8" });
    return { status: done.status ?? 128, output: `${done.stdout ?? ""}${done.stderr ?? ""}`, stdout: done.stdout ?? "", stderr: done.stderr ?? "" };
  };
  const must = (command: string, args: string[]) => {
    const done = run(command, args);
    if (done.status !== 0) throw new Error(`${command} ${args.slice(0, 3).join(" ")} failed:\n${done.output}`);
    return done.stdout;
  };
  const script = (name: string, args: string[]) => run(process.execPath, [join(import.meta.dirname, name), ...args]);
  const graphql = (query: string, id: string) => JSON.parse(must("gh", ["api", "graphql", "-f", `query=${query}`, "-F", `id=${id}`])) as { data: { node: Record<string, unknown> } };
  return {
    fetchMain: () => run("git", ["fetch", "origin", "main"]).status === 0,
    fetchPull: (pr) => {
      must("git", ["fetch", "origin", `refs/pull/${pr}/head`]);
      return must("git", ["rev-parse", "FETCH_HEAD"]).trim();
    },
    head: () => must("git", ["rev-parse", "HEAD"]).trim(),
    isBehind: (ancestor, commit) => run("git", ["merge-base", "--is-ancestor", ancestor, commit]).status === 0,
    pullRequest: (pr) => JSON.parse(must("gh", ["pr", "view", String(pr), "--json", "id,headRefOid"])) as { id: string; headRefOid: string },
    mergeTree: (commit) => run("git", ["merge-tree", "--write-tree", "origin/main", commit]),
    check: (name, commit) => (name === "drift" ? script("check-migration-drift.ts", ["origin/main", commit]) : script("check-migrations-immutable.ts", ["origin/main", commit])),
    status: (id) => graphql("query($id: ID!) { node(id: $id) { ... on PullRequest { state isInMergeQueue } } }", id).data.node as unknown as PullStatus,
    removalReason: (id) => {
      const node = graphql("query($id: ID!) { node(id: $id) { ... on PullRequest { timelineItems(last: 1, itemTypes: [REMOVED_FROM_MERGE_QUEUE_EVENT]) { nodes { ... on RemovedFromMergeQueueEvent { reason } } } } } }", id).data.node as {
        timelineItems?: { nodes?: { reason?: string }[] };
      };
      return node.timelineItems?.nodes?.[0]?.reason;
    },
    enqueue: (id, head) => {
      const answer = JSON.parse(must("gh", ["api", "graphql", "-f", `query=${mutation}`, "-F", `id=${id}`, "-F", `head=${head}`])) as {
        data: { enqueuePullRequest: { mergeQueueEntry: { position: number; state: string } } };
      };
      return answer.data.enqueuePullRequest.mergeQueueEntry;
    },
  };
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  const args = process.argv.slice(2);
  const wait = args.includes("--wait");
  const pr = Number(args.find((arg) => !arg.startsWith("--")));
  if (!Number.isInteger(pr) || pr <= 0) {
    console.error("Usage: pnpm queue <pr number> [--wait]");
    process.exit(2);
  }
  try {
    const seam = realSeam();
    let result = queuePr(pr, seam);
    for (const line of result.lines) (result.ok ? console.log : console.error)(line);
    if (result.ok && wait) {
      console.log(`Waiting for PR #${pr} to merge (polling every ${POLL_MS / 1000} s)...`);
      result = await waitForMerge(pr, seam);
      for (const line of result.lines) (result.ok ? console.log : console.error)(line);
    }
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
