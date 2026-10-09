import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { keysToClose } from "./jira-close-keys.ts";

// Closes the Jira tickets a merged pull request names (RP-307). Run by
// .github/workflows/jira-close.yml, which replaces the Jira Automation rule.
//
//   node scripts/jira-close.ts event   the pull_request event that just merged (GITHUB_EVENT_PATH)
//   node scripts/jira-close.ts sweep   every PR merged in the last 7 days (nightly backstop)
//
// Environment: JIRA_EMAIL, JIRA_API_TOKEN (repo secrets), GITHUB_TOKEN and
// GITHUB_REPOSITORY (sweep only). Reads PR metadata only; runs no PR code.
// Exits 1 when any ticket could not be closed, so the failure is visible.

const JIRA = "https://rabaedsa.atlassian.net";

/** An issue with this label is a spec: the planning session closes it by hand, never a merge (RP-451). */
const SPEC_LABEL = "spec";

export interface Jira {
  /** Labels of the ticket. Throws if the ticket is missing. */
  labels(key: string): Promise<string[]>;
  /** Status category key of the ticket: "new", "indeterminate" or "done". Throws if the ticket is missing. */
  statusCategory(key: string): Promise<string>;
  /** Moves the ticket to a Done-category status and comments. Throws if it can't. */
  closeWithComment(key: string, comment: string): Promise<void>;
}

export interface CloseResult {
  closed: string[];
  alreadyDone: string[];
  /** Spec issues named by the branch or body, left open. */
  skippedSpecs: string[];
  failed: { key: string; reason: string }[];
}

export async function closeIssues(keys: string[], pullRequest: number, jira: Jira): Promise<CloseResult> {
  const result: CloseResult = { closed: [], alreadyDone: [], skippedSpecs: [], failed: [] };
  for (const key of keys) {
    try {
      if ((await jira.labels(key)).includes(SPEC_LABEL)) {
        result.skippedSpecs.push(key);
        continue;
      }
      if ((await jira.statusCategory(key)) === "done") {
        result.alreadyDone.push(key);
        continue;
      }
      await jira.closeWithComment(key, `Closed by PR #${pullRequest} (merged)`);
      result.closed.push(key);
    } catch (error) {
      result.failed.push({ key, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

export function jiraOverHttp(email: string, token: string, fetchImpl: typeof fetch = fetch): Jira {
  const headers = { Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`, Accept: "application/json", "Content-Type": "application/json" };
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetchImpl(`${JIRA}/rest/api/3/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    // Status only: Jira's error text is not echoed into the log.
    if (!response.ok) throw new Error(`Jira ${method} ${path} answered ${response.status}`);
    return response.status === 204 ? undefined : ((await response.json()) as unknown);
  };
  return {
    async labels(key) {
      const issue = (await call("GET", `issue/${key}?fields=labels`)) as { fields: { labels: string[] } };
      return issue.fields.labels;
    },
    async statusCategory(key) {
      const issue = (await call("GET", `issue/${key}?fields=status`)) as { fields: { status: { statusCategory: { key: string } } } };
      return issue.fields.status.statusCategory.key;
    },
    async closeWithComment(key, comment) {
      const { transitions } = (await call("GET", `issue/${key}/transitions`)) as { transitions: { id: string; to: { statusCategory: { key: string } } }[] };
      const done = transitions.find((transition) => transition.to.statusCategory.key === "done");
      if (!done) throw new Error(`${key} has no transition to a Done status from its current status`);
      await call("POST", `issue/${key}/transitions`, { transition: { id: done.id } });
      await call("POST", `issue/${key}/comment`, { body: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: comment }] }] } });
    },
  };
}

interface PullRequestFacts {
  number: number;
  branch: string;
  body: string | null;
}

async function mergedInLastDays(days: number, repository: string, token: string): Promise<PullRequestFacts[]> {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const found: PullRequestFacts[] = [];
  for (let page = 1; page <= 10; page++) {
    const response = await fetch(`https://api.github.com/repos/${repository}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(`GitHub pull request list answered ${response.status}`);
    const pulls = (await response.json()) as { number: number; body: string | null; merged_at: string | null; updated_at: string; head: { ref: string } }[];
    for (const pull of pulls) {
      if (pull.merged_at && Date.parse(pull.merged_at) >= since) found.push({ number: pull.number, branch: pull.head.ref, body: pull.body });
    }
    // Sorted by last update: once a page ends before the window, no later page can merge inside it.
    const last = pulls.at(-1);
    if (!last || Date.parse(last.updated_at) < since) break;
  }
  return found;
}

function summary(markdown: string) {
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

async function main(mode: string) {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) throw new Error("JIRA_EMAIL and JIRA_API_TOKEN must be set (repository secrets)");
  const jira = jiraOverHttp(email, token);

  let pulls: PullRequestFacts[];
  if (mode === "event") {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8")) as { pull_request: { number: number; merged: boolean; body: string | null; head: { ref: string } } };
    const pull = event.pull_request;
    if (!pull.merged) return console.log("Closed without merging: nothing to do.");
    pulls = [{ number: pull.number, branch: pull.head.ref, body: pull.body }];
  } else if (mode === "sweep") {
    pulls = await mergedInLastDays(7, process.env.GITHUB_REPOSITORY ?? "", process.env.GITHUB_TOKEN ?? "");
  } else {
    throw new Error("usage: node scripts/jira-close.ts event|sweep");
  }

  const lines = [`### Jira close (${mode})`, ""];
  let failures = 0;
  for (const pull of pulls) {
    const keys = keysToClose({ branch: pull.branch, body: pull.body });
    const result = await closeIssues(keys, pull.number, jira);
    failures += result.failed.length;
    if (mode === "event" || result.closed.length > 0 || result.skippedSpecs.length > 0 || result.failed.length > 0) {
      lines.push(`- PR #${pull.number}: closed ${result.closed.join(", ") || "none"}; already Done ${result.alreadyDone.join(", ") || "none"}`);
      for (const spec of result.skippedSpecs) lines.push(`  - ${spec}: spec issue, left open`);
      for (const failure of result.failed) lines.push(`  - FAILED ${failure.key}: ${failure.reason}`);
    }
  }
  if (lines.length === 2) lines.push(`Checked ${pulls.length} merged PRs: all their Jira keys are Done.`);
  summary(lines.join("\n"));
  if (failures > 0) process.exit(1);
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  main(process.argv[2] ?? "").catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
