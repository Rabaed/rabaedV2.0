import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseDocument } from "yaml";

// Hardening rules for GitHub Actions workflows. Review found these four times
// (RP-248, fork pull requests, workflow_run), and the repository is public:
//
//  1. Every actions/checkout sets persist-credentials: false, unless a comment
//     above or inside the step says why credentials stay (it names "credentials").
//  2. No pull_request_target: it hands a write token to a fork's pull request.
//  3. A job with a write token (or an OIDC token) that checks out code, in a
//     workflow started by a pull request or by workflow_run, runs only for this
//     repository's own branches: its `if`, or the `if` of a job it needs,
//     compares the head repository with github.repository. Fork code never
//     meets a write token.
//  4. Actions outside actions/ and github/ are pinned to a full commit SHA
//     (a tag can be moved); docker:// images to a digest. Keep the tag in a
//     trailing comment.
//  5. Untrusted text (branch names, titles, commit messages) is never written
//     into a run: script, only passed through env.
//
// Usage: node scripts/check-workflows.ts   (from the repository root)

export interface Finding {
  file: string;
  where: string;
  message: string;
}

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);

const sameRepoGuard = /head[._]repo[a-z_.]*\.full_name\s*==\s*github\.repository/;
const untrustedInScript =
  /\$\{\{\s*(github\.head_ref|github\.event\.pull_request\.(title|body|head\.ref|head\.label)|github\.event\.workflow_run\.(head_branch|display_title|head_commit\.message)|github\.event\.head_commit\.message|github\.event\.(issue|comment)\.(title|body)|github\.event\.review\.body)\s*\}\}/;

function triggers(on: unknown): string[] {
  if (typeof on === "string") return [on];
  if (Array.isArray(on)) return on.map(String);
  return isObj(on) ? Object.keys(on) : [];
}

/** True when the permissions block grants any write, an OIDC token included. */
function grantsWrite(permissions: unknown): boolean {
  if (permissions === "write-all") return true;
  return isObj(permissions) && Object.values(permissions).includes("write");
}

/** Lint one workflow (or composite action) file. */
export function lintWorkflow(file: string, source: string): Finding[] {
  const findings: Finding[] = [];
  const add = (where: string, message: string) => findings.push({ file, where, message });
  const doc = parseDocument(source);
  if (doc.errors.length > 0) {
    add("file", `is not valid YAML: ${doc.errors[0]?.message}`);
    return findings;
  }
  const root = doc.toJS() as unknown;
  if (!isObj(root)) return findings;

  const lines = source.split("\n");
  const lineOf = (offset: number) => source.slice(0, offset).split("\n").length - 1;
  /** The step's own text plus the comment lines directly above it. */
  const stepText = (node: unknown): string => {
    const range = (node as { range?: [number, number, number] } | undefined)?.range;
    if (!range) return "";
    let first = lineOf(range[0]);
    while (first > 0 && /^\s*#/.test(lines[first - 1] ?? "")) first--;
    return lines.slice(first, lineOf(Math.max(range[0], range[1] - 1)) + 1).join("\n");
  };

  // 2. pull_request_target
  const on = triggers(root.on);
  if (on.includes("pull_request_target")) add("on", "uses pull_request_target, which runs with a write token on a fork's pull request; use pull_request, or workflow_run for what needs a write token");

  const stepItems = (path: string[]) => (doc.getIn(path, true) as { items?: unknown[] } | undefined)?.items ?? [];
  const stepGroups: { where: string; steps: unknown[]; nodes: unknown[] }[] = [];
  const jobs = isObj(root.jobs) ? root.jobs : {};
  for (const [id, job] of Object.entries(jobs)) {
    if (isObj(job) && Array.isArray(job.steps)) stepGroups.push({ where: `job ${id}`, steps: job.steps, nodes: stepItems(["jobs", id, "steps"]) });
  }
  if (isObj(root.runs) && Array.isArray(root.runs.steps)) stepGroups.push({ where: "runs", steps: root.runs.steps, nodes: stepItems(["runs", "steps"]) });

  const checksOut = new Set<string>();
  for (const { where, steps, nodes } of stepGroups) {
    steps.forEach((step, index) => {
      if (!isObj(step)) return;
      const label = `${where}, step ${index + 1}${typeof step.name === "string" ? ` (${step.name})` : ""}`;
      // 5. Script injection
      if (typeof step.run === "string" && untrustedInScript.test(step.run)) add(label, "writes untrusted text into a run: script (script injection); pass it through env: and read the variable");
      const uses = typeof step.uses === "string" ? step.uses : undefined;
      if (!uses || uses.startsWith("./")) return;
      // 4. Pinning
      if (uses.startsWith("docker://")) {
        if (!/@sha256:[0-9a-f]{64}$/.test(uses)) add(label, `uses ${uses}, a Docker image not pinned to a @sha256 digest`);
        return;
      }
      const [action = "", ref = ""] = uses.split("@");
      const owner = action.split("/")[0];
      if (owner !== "actions" && owner !== "github" && !/^[0-9a-f]{40}$/.test(ref)) add(label, `uses ${uses}, a third-party action not pinned to a full commit SHA (keep the tag in a trailing comment)`);
      // 1. Credentials
      if (action === "actions/checkout") {
        checksOut.add(where);
        const persist = (isObj(step.with) ? step.with : {})["persist-credentials"];
        if (persist !== false && persist !== "false" && !/#[^\n]*credentials/i.test(stepText(nodes[index]))) {
          add(label, "actions/checkout does not set persist-credentials: false (or a comment naming the reason credentials stay)");
        }
      }
    });
  }

  // 3. Write tokens and fork code
  if (on.includes("pull_request") || on.includes("workflow_run")) {
    const guarded = (id: string, seen = new Set<string>()): boolean => {
      if (seen.has(id)) return false;
      seen.add(id);
      const job = jobs[id];
      if (!isObj(job)) return false;
      if (typeof job.if === "string" && sameRepoGuard.test(job.if)) return true;
      const needs = typeof job.needs === "string" ? [job.needs] : Array.isArray(job.needs) ? job.needs.map(String) : [];
      return needs.some((need) => guarded(need, seen));
    };
    for (const [id, job] of Object.entries(jobs)) {
      if (!isObj(job)) continue;
      const permissions = "permissions" in job ? job.permissions : root.permissions;
      if (!grantsWrite(permissions) || !checksOut.has(`job ${id}`)) continue;
      if (!guarded(id)) add(`job ${id}`, "holds a write (or id-token) permission and checks out code, but nothing in its if: or its needs' if: limits it to this repository's own branches (head repository == github.repository)");
    }
  }
  return findings;
}

/** Every workflow and composite action file under the repository. */
export function workflowFiles(repo: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, accept: (name: string) => boolean) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path, accept);
      else if (accept(entry.name)) out.push(path);
    }
  };
  walk(join(repo, ".github", "workflows"), (name) => /\.ya?ml$/.test(name));
  walk(join(repo, ".github", "actions"), (name) => /^action\.ya?ml$/.test(name));
  return out.sort();
}

export function lintRepository(repo: string): Finding[] {
  return workflowFiles(repo).flatMap((path) => lintWorkflow(path.slice(repo.length + 1).replaceAll("\\", "/"), readFileSync(path, "utf8")));
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  const findings = lintRepository(process.cwd());
  if (findings.length > 0) {
    console.error("GitHub Actions workflows break hardening rules (see scripts/check-workflows.ts):");
    for (const finding of findings) console.error(`  ${finding.file}: ${finding.where}: ${finding.message}`);
    process.exit(1);
  }
  console.log(`${workflowFiles(process.cwd()).length} workflow files follow the hardening rules.`);
}
