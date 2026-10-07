import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

// `pnpm queue <pr>` (RP-400, from the PR #149 retro): checks the branch against
// today's origin/main, then queues the PR. A PR whose CI went green hours ago
// can have lost to a newer main (a migration with the same timestamp, a text
// conflict); the queue removes it for that, and every re-queue costs a full run.
//
// Run it in the PR's own worktree, as one plain command: `pnpm queue 149`.
// The git and gh calls sit behind QueueSeam so the tests touch no network.

export interface QueueSeam {
  /** `git fetch origin main`; false when it fails. */
  fetchMain(): boolean;
  /** The commit HEAD points at. */
  head(): string;
  /** `gh pr view <pr> --json id,headRefOid` */
  pullRequest(pr: number): { id: string; headRefOid: string };
  /** `git merge-tree --write-tree origin/main HEAD`: status 0 when it merges cleanly, 1 when it conflicts, anything else is an error. */
  mergeTree(): { status: number; output: string; stderr: string };
  /** The migration checks against origin/main; status 0 when they pass. */
  check(name: "drift" | "immutable"): { status: number; output: string };
  /** The `enqueuePullRequest` mutation, pinned by expectedHeadOid. */
  enqueue(id: string, head: string): { position: number; state: string };
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

  const head = seam.head();
  const pull = seam.pullRequest(pr);
  if (head !== pull.headRefOid) {
    return fail(
      `HEAD (${head}) is not PR #${pr}'s head (${pull.headRefOid}), so these checks would not be about what gets queued.`,
      "Fix: push this branch (or switch to the PR's branch and pull), wait for CI, then run `pnpm queue` again.",
    );
  }

  const merge = seam.mergeTree();
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

  const drift = seam.check("drift");
  if (drift.status !== 0) {
    return fail(drift.output.trimEnd(), "Fix: merge main, rename the migration so it sorts after main's latest, push, wait for CI, then run `pnpm queue` again.");
  }
  const immutable = seam.check("immutable");
  if (immutable.status !== 0) {
    return fail(immutable.output.trimEnd(), "Fix: merge main, rename the migration so it sorts after main's latest (an existing migration is never edited), push, wait for CI, then run `pnpm queue` again.");
  }

  const entry = seam.enqueue(pull.id, head);
  return { ok: true, lines: [`Queued PR #${pr} at ${head}: position ${entry.position}, state ${entry.state}.`] };
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
  return {
    fetchMain: () => run("git", ["fetch", "origin", "main"]).status === 0,
    head: () => must("git", ["rev-parse", "HEAD"]).trim(),
    pullRequest: (pr) => JSON.parse(must("gh", ["pr", "view", String(pr), "--json", "id,headRefOid"])) as { id: string; headRefOid: string },
    mergeTree: () => run("git", ["merge-tree", "--write-tree", "origin/main", "HEAD"]),
    check: (name) => (name === "drift" ? script("check-migration-drift.ts", ["origin/main", "HEAD"]) : script("check-migrations-immutable.ts", ["origin/main"])),
    enqueue: (id, head) => {
      const answer = JSON.parse(must("gh", ["api", "graphql", "-f", `query=${mutation}`, "-F", `id=${id}`, "-F", `head=${head}`])) as {
        data: { enqueuePullRequest: { mergeQueueEntry: { position: number; state: string } } };
      };
      return answer.data.enqueuePullRequest.mergeQueueEntry;
    },
  };
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  const pr = Number(process.argv[2]);
  if (!Number.isInteger(pr) || pr <= 0) {
    console.error("Usage: pnpm queue <pr number>");
    process.exit(2);
  }
  try {
    const result = queuePr(pr, realSeam());
    for (const line of result.lines) (result.ok ? console.log : console.error)(line);
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
