// RP-1197 (item 5): `node scripts/orch-status.ts` is the Orchestrator's one-glance check-in: each open PR
// (head, CI, `reviewed` and who added it, auto-merge, queue position), the merge queue, the running
// stacks and the running and waiting verifies. It only reads, uses one `gh pr list` and one GraphQL call
// (plus one events call per PR that carries `reviewed`), and always exits 0: a half that cannot be read
// becomes a warning line. With nothing at all it prints a single "Nothing to report" line.
//   node scripts/orch-status.ts
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { formatOrchStatus, type OpenPr, type OrchData, type QueueEntry } from "./orch-status-lines.ts";
import { listContainers } from "./lanes.ts";
import { runningStacks } from "./machine-load.ts";
import { REVIEWED_LABEL } from "./reviewed-label.ts";
import type { PrEvent } from "./reviewed-required.ts";
import { verifiesRunningNow, type VerifyCheck } from "./verifies-running.ts";
import { describeHolder } from "./verify-lock.ts";
import { describeRun } from "./verify-queue.ts";
import { DOCKER_TIMEOUT_MS } from "./verify-health.ts";

/** Runs `gh` with these arguments and returns its stdout; throws when it fails. */
export type Gh = (args: string[]) => string;

/** The real `gh`: no shell, no jq. */
export const realGh: Gh = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, maxBuffer: 64 * 1024 * 1024 });

const PR_FIELDS = "number,headRefName,headRefOid,isDraft,labels,autoMergeRequest,statusCheckRollup";
// eslint-disable-next-line rabaed/no-avoid-terms -- GitHub's merge queue, by its own name.
const QUEUE_QUERY = "query($owner:String!,$name:String!){repository(owner:$owner,name:$name){mergeQueue(branch:\"main\"){entries(first:50){nodes{position state pullRequest{number}}}}}}";

/** The open PRs: one `gh pr list` call. */
export function readOpenPrs(gh: Gh): OpenPr[] {
  return JSON.parse(gh(["pr", "list", "--state", "open", "--limit", "100", "--json", PR_FIELDS])) as OpenPr[];
}

/** The merge queue's entries in queue order: one `gh repo view` and one GraphQL call. */
// eslint-disable-next-line rabaed/no-avoid-terms -- GitHub's merge queue, by its own name.
export function readQueue(gh: Gh): QueueEntry[] {
  const repo = JSON.parse(gh(["repo", "view", "--json", "owner,name"])) as { owner: { login: string }; name: string };
  const answer = JSON.parse(gh(["api", "graphql", "-f", `query=${QUEUE_QUERY}`, "-F", `owner=${repo.owner.login}`, "-F", `name=${repo.name}`])) as {
    // eslint-disable-next-line rabaed/no-avoid-terms -- GitHub's merge queue, by its own name.
    data?: { repository?: { mergeQueue?: { entries?: { nodes?: { position: number; state: string; pullRequest?: { number: number } }[] } } | null } };
  };
  const nodes = answer.data?.repository?.mergeQueue?.entries?.nodes ?? [];
  return nodes.filter((n) => n.pullRequest).map((n) => ({ position: n.position, state: n.state, pr: n.pullRequest!.number })).sort((a, b) => a.position - b.position);
}

/** A PR's label events (who added `reviewed`), oldest first. */
export function readEvents(gh: Gh, pr: number): PrEvent[] {
  const raw = JSON.parse(gh(["api", `repos/{owner}/{repo}/issues/${pr}/events?per_page=100`, "--paginate", "--slurp"])) as { event: string; label?: { name: string }; actor?: { login: string }; created_at: string }[][];
  return raw.flat().map((e) => ({ event: e.event, label: e.label?.name, actor: e.actor?.login ?? "", createdAt: e.created_at }));
}

/** What the machine has: running stacks (project names) or undefined when Docker does not answer, and the verifies check. */
export interface LocalSeam {
  stacks(): string[] | undefined;
  verifies(): VerifyCheck;
}

/** The real Docker and lock reads. */
export const realLocal: LocalSeam = {
  stacks: () => runningStacks(listContainers(DOCKER_TIMEOUT_MS) ?? []).map((s) => s.project),
  verifies: () => verifiesRunningNow(),
};

const reason = (error: unknown) => ((error as { stderr?: string }).stderr || (error as Error).message || String(error)).split("\n")[0]!.trim();

/** Gathers the data; each half in its own try so one failure leaves the rest. */
export function gather(gh: Gh, local: LocalSeam): OrchData {
  // eslint-disable-next-line rabaed/no-avoid-terms -- GitHub's merge queue, by its own name.
  const data: OrchData = { prs: [], events: new Map(), queue: [], stacks: [], running: [], waiting: [], warnings: [] };
  try {
    data.prs = readOpenPrs(gh);
  } catch (error) {
    data.warnings.push(`gh could not list the open PRs (${reason(error)}).`);
  }
  try {
    data.queue = readQueue(gh);
  } catch (error) {
    // eslint-disable-next-line rabaed/no-avoid-terms -- GitHub's merge queue, by its own name.
    data.warnings.push(`the merge queue could not be read (${reason(error)}).`);
  }
  for (const pr of data.prs) {
    if (!(pr.labels ?? []).some((l) => l.name === REVIEWED_LABEL)) continue;
    try {
      data.events.set(pr.number, readEvents(gh, pr.number));
    } catch (error) {
      data.warnings.push(`PR ${pr.number}: who added \`reviewed\` could not be read (${reason(error)}).`);
    }
  }
  try {
    const stacks = local.stacks();
    if (stacks === undefined) data.warnings.push("Docker is not answering: the running stacks are unknown.");
    else data.stacks = stacks;
  } catch (error) {
    data.warnings.push(`the running stacks could not be read (${reason(error)}).`);
  }
  try {
    const check = local.verifies();
    if ("unknown" in check) data.warnings.push(`whether a verify runs could not be checked (${check.unknown}).`);
    else {
      data.running = check.runs.map((r) => `${describeHolder(r.holder)}, in ${r.where}`);
      data.waiting = (check.waiting ?? []).map((r) => `${describeRun(r.holder)}, in ${r.where}`);
    }
  } catch (error) {
    data.warnings.push(`the verifies could not be read (${reason(error)}).`);
  }
  return data;
}

/** The report lines for this machine now. */
export const orchStatus = (gh: Gh = realGh, local: LocalSeam = realLocal): string[] => formatOrchStatus(gather(gh, local));


if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  for (const line of orchStatus()) console.log(line);
}
