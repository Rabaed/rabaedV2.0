import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { classify, type RemovalKind } from "./queue-drop-comment.ts";
import { REVIEWED_LABEL } from "./reviewed-label.ts";
import { DOCS_ONLY_LABEL, isDoc, REQUIRED_CHECK, reviewGate } from "./reviewed-required.ts";
import { isAncestor } from "./worktrees.ts";

// `pnpm queue <pr>` (RP-400, from the PR #149 retro): checks the branch against
// today's origin/main, then queues the PR. A PR whose CI went green hours ago
// can have lost to a newer main (a migration with the same timestamp, a text
// conflict); the queue removes it for that, and every re-queue costs a full run.
//
// Run it from any checkout, as one plain command: `pnpm queue 149 --wait` (RP-454).
// The checks and the queue entry use the PR's own head (refs/pull/<n>/head), not
// HEAD. --wait polls every 60 s until the PR merges (exit 0) or leaves the queue
// or closes (exit 1, with the reason).
// The PR needs the `reviewed` label (a finished /code-review, RP-584), or the `docs-only` label when
// every file it changes is a doc: the rule of the main ruleset's reviewed-required check (RP-606).
// --no-review only names the docs-only label when it is missing; it no longer skips the rule.
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
  /** The checked-out branch name; "HEAD" when detached. */
  branch(): string;
  /** True when `ancestor` is an ancestor of `commit` or the same commit (`git merge-base --is-ancestor`). */
  isAncestor(ancestor: string, commit: string): boolean;
  /** `gh pr view <pr> --json id,headRefOid,headRefName` */
  pullRequest(pr: number): { id: string; headRefOid: string; headRefName: string };
  /** `git merge-tree --write-tree origin/main <commit>`: status 0 when it merges cleanly, 1 when it conflicts, anything else is an error. */
  mergeTree(commit: string): { status: number; output: string; stderr: string };
  /** Paths the PR changes against main (`git diff --name-only origin/main...<commit>`). */
  changedFiles(commit: string): string[];
  /** A package.json's text at the merge base of origin/main and `commit` (what the three-dot `changedFiles` diffs against) and at `commit`; undefined where it does not exist. */
  packageJsonVersions(commit: string, file: string): { before: string | undefined; after: string | undefined };
  /** The migration checks of `commit` against origin/main; status 0 when they pass. */
  check(name: "drift" | "immutable", commit: string): { status: number; output: string };
  /** The PR's label names (`gh pr view <pr> --json labels`). */
  labels(pr: number): string[];
  /** True when `.github/workflows/reviewed-label.yml` exists on origin/main (`git cat-file -e`). */
  labelWorkflowOnMain(): boolean;
  /** The `reviewed-label` workflow's runs for `commit`, newest first (`gh run list --workflow reviewed-label.yml --commit`). */
  labelRuns(commit: string): { status: string; conclusion: string }[];
  /** The `enqueuePullRequest` mutation, pinned by expectedHeadOid. */
  enqueue(id: string, head: string): { position: number; state: string };
  /** The PR's `state` and `isInMergeQueue` (GraphQL; `gh pr view` has no such field). */
  status(id: string): PullStatus;
  /** The reason of the PR's latest RemovedFromMergeQueueEvent created at or after `since` (an enum, e.g. MERGE_CONFLICT); undefined when there is none. */
  removalReason(id: string, since: Date): string | undefined;
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

/** Root shared files (rule 3): exact paths, then path prefixes. */
const ROOT_SHARED = { files: ["package.json", "pnpm-lock.yaml"], prefixes: [".github/workflows/"] };
const isRootShared = (file: string) => ROOT_SHARED.files.includes(file) || ROOT_SHARED.prefixes.some((prefix) => file.startsWith(prefix));
const rootSharedList = [...ROOT_SHARED.files, ...ROOT_SHARED.prefixes.map((prefix) => `${prefix}*`)].join(", ");
const isWorkspacePackageJson = (file: string) => file.endsWith("/package.json");

/** Rule 3 (planning/parallel-sessions.md): root shared files travel in their own PR, with at most docs. */
export function rootSharedFilesBreach(files: string[], isDependencyOnlyChange: (file: string) => boolean = () => false): { root: string[]; others: number; example: string } | undefined {
  const root = files.filter(isRootShared);
  const others = files.filter((file) => !isRootShared(file) && !isDoc(file) && !isDependencyOnlyChange(file));
  const [example] = others;
  return root.length > 0 && example !== undefined ? { root, others: others.length, example } : undefined;
}

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

/** RP-573: true when two versions of a workspace package.json differ only in the dependency fields (both must exist and parse). */
export function onlyDependencyFieldsChanged(before: string | undefined, after: string | undefined): boolean {
  if (before === undefined || after === undefined) return false;
  try {
    const strip = (text: string) => JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(text) as Record<string, unknown>).filter(([key]) => !DEPENDENCY_FIELDS.includes(key))));
    return strip(before) === strip(after);
  } catch {
    return false;
  }
}

export function queuePr(pr: number, seam: QueueSeam, options: { noReview?: boolean } = {}): QueueResult {
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
  const changed = seam.changedFiles(head);
  // The same rule as the main ruleset's reviewed-required check (RP-606), so what this queues the queue keeps.
  const gate = reviewGate(seam.labels(pr), changed);
  if (!gate.ok) {
    const docsOnlyFix = `For a PR that changes only docs: \`gh pr edit ${pr} --add-label ${DOCS_ONLY_LABEL}\`, wait for the ${REQUIRED_CHECK} check, then \`pnpm queue ${pr}\` again.`;
    if (options.noReview) {
      return fail(
        `PR #${pr}: --no-review needs the '${DOCS_ONLY_LABEL}' label now: ${gate.reason}. Without it the main ruleset's ${REQUIRED_CHECK} check fails and the queue drops the PR.`,
        `Fix: ${docsOnlyFix} A PR that changes more than docs needs a /code-review and the '${REVIEWED_LABEL}' label.`,
      );
    }
    return fail(
      `PR #${pr}: ${gate.reason}. planning/parallel-sessions.md rule 6 queues a PR only after a finished /code-review.`,
      `Fix: run /code-review, push its fixes, then \`gh pr edit ${pr} --add-label ${REVIEWED_LABEL}\` and run \`pnpm queue ${pr}\` again. A new push removes the label. ${docsOnlyFix}`,
    );
  }
  if (gate.via === DOCS_ONLY_LABEL) {
    warnings.push(`Warning: queued under the '${DOCS_ONLY_LABEL}' label (every changed file is a doc); nothing checked that a /code-review finished.`);
  } else if (seam.labelWorkflowOnMain()) {
    // The label alone is not tied to a head: a push whose workflow run has not finished (or never ran, as with a merge conflict) still shows the old label.
    const runs = seam.labelRuns(head);
    const wait = `Fix: wait for the reviewed-label run on ${head}, then run \`pnpm queue ${pr}\` again.`;
    if (runs.length === 0 || runs.some((run) => run.status !== "completed")) {
      // Since RP-604 a PR's opening makes a run too; a PR opened before that and not pushed to since has none.
      const none = runs.length === 0 ? " A PR opened before RP-604 and not pushed to since never gets one: merge origin/main in cleanly and push (the label stays)." : "";
      return fail(`PR #${pr}: the reviewed-label workflow has not finished for the head ${head}, so the '${REVIEWED_LABEL}' label may be left over from an earlier head.`, wait + none);
    }
    const [latest] = runs;
    if (latest?.conclusion !== "success" && latest?.conclusion !== "skipped") {
      return fail(`PR #${pr}: the reviewed-label run on ${head} failed (${latest?.conclusion}), so the '${REVIEWED_LABEL}' label cannot be trusted.`, "Fix: open the run in the Actions tab, re-run it, then run `pnpm queue " + pr + "` again.");
    }
  } else {
    warnings.push("Warning: .github/workflows/reviewed-label.yml is not on origin/main yet, so the label could not be tied to the head; not checked.");
  }
  const checkout = seam.head();
  // Only a checkout of the PR's own branch can be behind it; an old main is just another branch.
  if (checkout !== head && seam.branch() === pull.headRefName && seam.isAncestor(checkout, head)) {
    warnings.push(`Warning: HEAD (${checkout}) is behind PR #${pr}'s head (${head}); checked and queued the PR's head. Pull to catch up.`);
  }

  // A workspace package.json that changes only dependency fields belongs to a dependencies-only PR beside the lockfile (RP-573).
  const shared = rootSharedFilesBreach(changed, (file) => {
    if (!isWorkspacePackageJson(file)) return false;
    const { before, after } = seam.packageJsonVersions(head, file);
    return onlyDependencyFieldsChanged(before, after);
  });
  if (shared) {
    return fail(
      `PR #${pr} breaks planning/parallel-sessions.md rule 3: it changes root shared file(s) together with other files.`,
      ...shared.root.map((file) => `  shared: ${file}`),
      `  and ${shared.others} other file(s), e.g. ${shared.example}`,
      ...(changed.some(isWorkspacePackageJson)
        ? ["Note: a workspace package.json beside the lockfile is allowed when only its dependency fields (dependencies/devDependencies/peerDependencies/optionalDependencies) change."]
        : []),
      `Fix: a change to root ${rootSharedList} is its own PR (only those and docs). Split it out, then run \`pnpm queue\` again.`,
    );
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
export async function waitForMerge(pr: number, seam: QueueSeam, since: Date, sleep: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms))): Promise<QueueResult> {
  const { id } = seam.pullRequest(pr);
  let outside = 0;
  for (;;) {
    const { state, isInMergeQueue } = seam.status(id);
    if (state === "MERGED") return { ok: true, lines: [`PR #${pr} merged.`] };
    if (state === "CLOSED") return fail(`PR #${pr} was closed without merging.`);
    // One poll outside the queue can be the merge landing; two in a row is a removal.
    outside = isInMergeQueue ? 0 : outside + 1;
    if (outside >= 2) {
      const reason = seam.removalReason(id, since) ?? "unknown";
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
  const graphql = (query: string, variables: Record<string, string>) =>
    JSON.parse(must("gh", ["api", "graphql", "-f", `query=${query}`, ...Object.entries(variables).flatMap(([name, value]) => ["-F", `${name}=${value}`])])) as { data: Record<string, unknown> & { node: Record<string, unknown> } };
  return {
    fetchMain: () => run("git", ["fetch", "origin", "main"]).status === 0,
    fetchPull: (pr) => {
      must("git", ["fetch", "origin", `refs/pull/${pr}/head`]);
      return must("git", ["rev-parse", "FETCH_HEAD"]).trim();
    },
    head: () => must("git", ["rev-parse", "HEAD"]).trim(),
    branch: () => must("git", ["rev-parse", "--abbrev-ref", "HEAD"]).trim(),
    isAncestor: (ancestor, commit) => isAncestor(ancestor, commit, cwd, spawn),
    pullRequest: (pr) => JSON.parse(must("gh", ["pr", "view", String(pr), "--json", "id,headRefOid,headRefName"])) as { id: string; headRefOid: string; headRefName: string },
    mergeTree: (commit) => run("git", ["merge-tree", "--write-tree", "origin/main", commit]),
    changedFiles: (commit) =>
      must("git", ["diff", "--name-only", `origin/main...${commit}`])
        .split("\n")
        .filter(Boolean),
    packageJsonVersions: (commit, file) => {
      const show = (ref: string) => {
        const done = run("git", ["show", `${ref}:${file}`]);
        return done.status === 0 ? done.stdout : undefined;
      };
      // changedFiles diffs against the merge base (three dots), so `before` is read there, not at main's tip.
      const base = run("git", ["merge-base", "origin/main", commit]);
      return { before: base.status === 0 ? show(base.stdout.trim()) : undefined, after: show(commit) };
    },
    check: (name, commit) => (name === "drift" ? script("check-migration-drift.ts", ["origin/main", commit]) : script("check-migrations-immutable.ts", ["origin/main", commit])),
    labels: (pr) => (JSON.parse(must("gh", ["pr", "view", String(pr), "--json", "labels"])) as { labels: { name: string }[] }).labels.map((label) => label.name),
    labelWorkflowOnMain: () => run("git", ["cat-file", "-e", "origin/main:.github/workflows/reviewed-label.yml"]).status === 0,
    labelRuns: (commit) => JSON.parse(must("gh", ["run", "list", "--workflow", "reviewed-label.yml", "--commit", commit, "--json", "status,conclusion"])) as { status: string; conclusion: string }[],
    status: (id) => graphql("query($id: ID!) { node(id: $id) { ... on PullRequest { state isInMergeQueue } } }", { id }).data.node as unknown as PullStatus,
    removalReason: (id, since) => {
      const node = graphql("query($id: ID!) { node(id: $id) { ... on PullRequest { timelineItems(last: 1, itemTypes: [REMOVED_FROM_MERGE_QUEUE_EVENT]) { nodes { ... on RemovedFromMergeQueueEvent { reason createdAt } } } } } }", { id }).data.node as {
        timelineItems?: { nodes?: { reason?: string; createdAt?: string }[] };
      };
      const latest = node.timelineItems?.nodes?.[0];
      // An older removal (an earlier queue attempt) is not why this wait ended.
      return latest?.createdAt !== undefined && Date.parse(latest.createdAt) >= since.getTime() ? latest.reason : undefined;
    },
    enqueue: (id, head) => {
      const answer = graphql(mutation, { id, head }).data as unknown as { enqueuePullRequest: { mergeQueueEntry: { position: number; state: string } } };
      return answer.enqueuePullRequest.mergeQueueEntry;
    },
  };
}

function print(result: QueueResult): QueueResult {
  for (const line of result.lines) (result.ok ? console.log : console.error)(line);
  return result;
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  const args = process.argv.slice(2);
  const wait = args.includes("--wait");
  const pr = Number(args.find((arg) => !arg.startsWith("--")));
  if (!Number.isInteger(pr) || pr <= 0) {
    console.error("Usage: pnpm queue <pr number> [--wait] [--no-review]");
    process.exit(2);
  }
  try {
    const seam = realSeam();
    const started = new Date();
    let result = print(queuePr(pr, seam, { noReview: args.includes("--no-review") }));
    if (result.ok && wait) {
      console.log(`Waiting for PR #${pr} to merge (polling every ${POLL_MS / 1000} s)...`);
      result = print(await waitForMerge(pr, seam, started));
    }
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
