import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseDocument } from "yaml";

// Hardening rules for GitHub Actions workflows. Review found these four times
// (RP-248, fork pull requests, workflow_run), and the repository is public:
//
//  1. Every actions/checkout sets persist-credentials: false, unless a comment
//     above or inside the step reads "# keeps credentials: <reason>" (the
//     reason is required).
//  2. No pull_request_target: it hands a write token to a fork's pull request.
//  3. A job with a write token (or an OIDC token) that checks out code, in a
//     workflow started by a pull request or by workflow_run, runs only for this
//     repository's own branches: its `if`, or the `if` of a job it needs,
//     compares the head repository with github.repository. Fork code never
//     meets a write token. workflow_run is the preferred home for such jobs.
//     A pull_request job with the same guard is also accepted (as the retired
//     infra-diff.yml was, for an OIDC token and pull-requests: write): GitHub gives a fork's
//     pull_request run a read-only token and no OIDC token anyway, and the
//     guard stops the job running for forks at all, so fork code never meets
//     a write token there either. Only pull_request_target is banned.
//  4. Actions outside actions/ and github/ are pinned to a full commit SHA
//     (a tag can be moved); docker:// images to a digest. Keep the tag in a
//     trailing comment.
//  5. Untrusted text (branch names, titles, commit messages and authors,
//     workflow inputs, fork repository names) is never written
//     into a run: script, only passed through env.
//
// Log rules (RP-1199). The repository is public and so are its run logs and step
// summaries; one UAT workflow took six PRs to stop tester data leaking into them:
//
//  6. A workflow_dispatch input declared `type: string` (string is the default
//     type) is never read through ${{ inputs.x }} or ${{ github.event.inputs.x }}
//     in an env: (workflow, job or step) or in a run: script: the runner prints an
//     env block. Read it from the event file (jq on $GITHUB_EVENT_PATH). Choice,
//     boolean, number and environment inputs are fine in env:. A whole
//     ${{ inputs.x }} in a run: is rule 5's finding, so it is not reported twice.
//     Composite action inputs: are not workflow_dispatch inputs and are not checked.
//  7. A job that reads a string input (from the event file, or through an
//     expression) opens with a run: step that tests every string input it names
//     for a carriage return or newline (test("[\r\n]") on $GITHUB_EVENT_PATH, as
//     age-uat.yml does) and exits: a multi-line input would print its later lines
//     unmasked, and a line starting :: would be read as a workflow command. An
//     input that is only compared in a job if: (reset-uat.yml's `confirm`, an exact
//     match) and never read in a step needs no refusal, nor does a job that reads none.
//  8. A step under `environment: uat` that pipes into tee writing
//     $GITHUB_STEP_SUMMARY has the shared mask function as the stage right before
//     the tee: `... | masked | tee -a "$GITHUB_STEP_SUMMARY"`. A plain
//     `echo "fixed text" >> "$GITHUB_STEP_SUMMARY"` is not a tee and is not flagged.
//  9. ::add-mask:: never gets a value shorter than 8 characters (a short or common
//     value, like "2" or "auto", garbles the public log). A literal must be 8 or
//     more characters. A variable ($x, ${x}) needs a length test in the same script
//     (${#x} -ge 8, -gt 7, >= 8 or > 7); a non-empty test (-n) is not enough. A
//     command substitution or ${{ }} expression has no variable to test: assign it
//     to a variable first.
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
const untrustedInScript = new RegExp(
  String.raw`\$\{\{\s*(` +
    [
      String.raw`github\.head_ref`,
      String.raw`inputs\.[\w-]+`,
      String.raw`github\.event\.inputs\.[\w-]+`,
      String.raw`github\.event\.pull_request\.(title|body|head\.(ref|label|repo\.[\w.]+))`,
      String.raw`github\.event\.workflow_run\.(head_branch|display_title|head_repository\.[\w.]+|pull_requests\[\d+\]\.head\.ref|head_commit\.(message|author\.[\w.]+))`,
      String.raw`github\.event\.head_commit\.(message|author\.[\w.]+)`,
      String.raw`github\.event\.(issue|comment)\.(title|body)`,
      String.raw`github\.event\.review\.body`,
    ].join("|") +
    String.raw`)\s*\}\}`,
);
// The only accepted reason to leave credentials persisted: a comment such as
// "# keeps credentials: the push below needs them".
const keepsCredentials = /#\s*keeps credentials:[ \t]*\S/i;

/** The workflow_dispatch inputs by name, with their declared type (string when none is given: that is GitHub's default). */
function dispatchInputs(on: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const dispatch = isObj(on) ? on.workflow_dispatch : undefined;
  const inputs = isObj(dispatch) ? dispatch.inputs : undefined;
  if (!isObj(inputs)) return out;
  for (const [name, spec] of Object.entries(inputs)) out.set(name, isObj(spec) && typeof spec.type === "string" ? spec.type : "string");
  return out;
}

/** The workflow inputs a text reads through `inputs.x`, `inputs['x']` or `github.event.inputs.x` inside `${{ }}`. */
function inputsRead(text: string): string[] {
  const names: string[] = [];
  for (const expression of text.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
    for (const ref of (expression[1] ?? "").matchAll(/(?<![\w.])(?:github\.event\.)?inputs(?:\.([\w-]+)|\[\s*['"]([\w-]+)['"]\s*\])/g)) names.push(ref[1] ?? ref[2] ?? "");
  }
  return names;
}

/** The string values of an env block (workflow, job or step level). */
const envValues = (env: unknown): string[] => (isObj(env) ? Object.values(env).filter((value): value is string => typeof value === "string") : []);

/**
 * Each `tee` in a script whose arguments name $GITHUB_STEP_SUMMARY, with the pipe stage right before it.
 * A backslash-newline or a trailing `|` joins lines, so a pipeline written over several lines reads as one.
 */
function teesToSummary(script: string): { target: string; previousStage: string }[] {
  const joined = script.replace(/\\\r?\n/g, " ").replace(/\|[ \t]*\r?\n/g, "| ");
  const out: { target: string; previousStage: string }[] = [];
  for (const tee of joined.matchAll(/\btee\b([^\n|;&]*)/g)) {
    const target = /\$\{?GITHUB_STEP_SUMMARY\}?/.exec(tee[1] ?? "")?.[0];
    if (!target) continue;
    const line = joined.slice(joined.lastIndexOf("\n", tee.index) + 1, tee.index);
    const stages = line.split(/(?<!\|)\|(?!\|)/);
    out.push({ target, previousStage: stages.length > 1 ? (stages[stages.length - 2] ?? "") : "" });
  }
  return out;
}

const MIN_MASK = 8;

/**
 * What is wrong with the ::add-mask:: commands of one run: script. A literal value must be MIN_MASK characters or
 * more. A variable ($x, ${x}) must be length-tested in the same script (${#x} -ge 8, -gt 7, >= 8 or > 7). A command
 * substitution or ${{ }} expression has no variable to test, so it must be assigned to a variable first.
 */
function addMaskProblems(script: string): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const text = script.replace(/^[ \t]*#.*$/gm, "");
  const shortMask = `GitHub masks every occurrence of the value in the public log, so a short or common value (like "2" or "auto") garbles it; mask only values of ${MIN_MASK} characters or more`;
  for (const match of text.matchAll(/::add-mask::(\$\{\{[\s\S]*?\}\}|\$\([^)]*\)|\$\{[^}]*\}|\$[A-Za-z_]\w*|[^\s"'`;&|)]*)/g)) {
    const value = match[1] ?? "";
    if (seen.has(value)) continue;
    seen.add(value);
    if (!value.startsWith("$")) {
      if (value.length < MIN_MASK) problems.push(`gives ::add-mask:: a literal of ${value.length} characters (${MIN_MASK} needed); ${shortMask}`);
      continue;
    }
    const name = /^\$\{?([A-Za-z_]\w*)/.exec(value)?.[1];
    if (!name || value.startsWith("${{")) {
      problems.push(`gives ::add-mask:: ${value}, which has no variable whose length can be tested; assign it to a variable and mask it only when its length is ${MIN_MASK} or more (if [ "\${#v}" -ge ${MIN_MASK} ]; then echo "::add-mask::$v"; fi)`);
      continue;
    }
    const guard = new RegExp(String.raw`\$\{#${name}\}"?\s*(-ge|-gt|>=|>)\s*(\d+)`, "g");
    const guarded = [...text.matchAll(guard)].some(([, op = "", limit = "0"]) => (op === "-ge" || op === ">=" ? Number(limit) >= MIN_MASK : Number(limit) >= MIN_MASK - 1));
    if (!guarded) {
      problems.push(`gives ::add-mask:: the variable ${value} without a length test in the same script (a non-empty test is not enough); ${shortMask}: if [ "\${#${name}}" -ge ${MIN_MASK} ]; then echo "::add-mask::$${name}"; fi`);
    }
  }
  return problems;
}

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
        if (persist !== false && persist !== "false" && !keepsCredentials.test(stepText(nodes[index]))) {
          add(label, 'actions/checkout does not set persist-credentials: false (or carry a "# keeps credentials: <reason>" comment)');
        }
      }
    });
  }

  // 6. A string workflow_dispatch input stays out of env: and run:
  const strings = new Set([...dispatchInputs(root.on)].filter(([, type]) => type === "string").map(([name]) => name));
  if (strings.size > 0) {
    const checkEnv = (where: string, env: unknown, what: string) => {
      for (const value of envValues(env)) {
        for (const name of new Set(inputsRead(value).filter((input) => strings.has(input)))) {
          add(where, `puts the string input "${name}" in ${what} env:, which the public run log prints; read it from the event file instead (jq -r '.inputs.${name} // ""' "$GITHUB_EVENT_PATH"), or make the input a choice, boolean or number`);
        }
      }
    };
    checkEnv("workflow env", root.env, "the workflow's");
    for (const [id, job] of Object.entries(jobs)) if (isObj(job)) checkEnv(`job ${id}`, job.env, "the job's");
    for (const { where, steps } of stepGroups) {
      steps.forEach((step, index) => {
        if (!isObj(step)) return;
        const label = `${where}, step ${index + 1}${typeof step.name === "string" ? ` (${step.name})` : ""}`;
        checkEnv(label, step.env, "the step's");
        // Rule 5 already reports a whole `${{ inputs.x }}` in a run: script; this catches the other expression forms.
        if (typeof step.run === "string" && !untrustedInScript.test(step.run)) {
          for (const name of new Set(inputsRead(step.run).filter((input) => strings.has(input)))) {
            add(label, `reads the string input "${name}" in a run: script through an expression; read it from the event file instead (jq -r '.inputs.${name} // ""' "$GITHUB_EVENT_PATH")`);
          }
        }
      });
    }
  }

  // 7. A job that reads a string input refuses a carriage return or newline first
  if (strings.size > 0) {
    const workflowEnvReads = envValues(root.env).some((value) => inputsRead(value).some((input) => strings.has(input)));
    for (const { where, steps } of stepGroups) {
      if (!where.startsWith("job ")) continue;
      const texts = steps.map((step) => (isObj(step) ? JSON.stringify([step.run, step.with, step.env]) : ""));
      const readsEventFile = steps.some((step) => isObj(step) && typeof step.run === "string" && /GITHUB_EVENT_PATH/.test(step.run) && /\.inputs\b|github\.event\.inputs/.test(step.run));
      const readsByExpression = texts.some((text) => inputsRead(text.replace(/\\"/g, '"')).some((input) => strings.has(input)));
      if (!readsEventFile && !readsByExpression && !workflowEnvReads) continue;
      const named = [...strings].filter((name) => texts.some((text) => new RegExp(String.raw`(?<![\w-])${name}(?![\w-])`).test(text)));
      const first = steps[0];
      const run = isObj(first) && typeof first.run === "string" ? first.run : "";
      const refuses = /GITHUB_EVENT_PATH/.test(run) && /\\r/.test(run) && /\\n/.test(run) && /\bexit\b/.test(run);
      if (!refuses) {
        add(where, `reads string inputs (${named.join(", ") || [...strings].join(", ")}) but its first step does not refuse a carriage return or newline in them; a multi-line input prints its later lines unmasked in the public log. Make step 1 a run: that tests each one in the event file (jq -e --arg k "$key" '(.inputs[$k] // "") | test("[\\r\\n]")' "$GITHUB_EVENT_PATH") and exits 1, as age-uat.yml does`);
        continue;
      }
      const missing = named.filter((name) => !new RegExp(String.raw`(?<![\w-])${name}(?![\w-])`).test(run));
      if (missing.length > 0) add(where, `refuses a carriage return or newline in its first step but skips the string input${missing.length > 1 ? "s" : ""} ${missing.join(", ")}; test every string input the job reads in that step`);
    }
  }

  // 8. A tee to the step summary under environment uat goes through masked
  for (const [id, job] of Object.entries(jobs)) {
    if (!isObj(job) || !Array.isArray(job.steps)) continue;
    const environment = isObj(job.environment) ? job.environment.name : job.environment;
    if (environment !== "uat") continue;
    job.steps.forEach((step, index) => {
      if (!isObj(step) || typeof step.run !== "string") return;
      for (const tee of teesToSummary(step.run)) {
        if (!/^\s*masked\b/.test(tee.previousStage)) {
          add(`job ${id}, step ${index + 1}${typeof step.name === "string" ? ` (${step.name})` : ""}`, `pipes to tee ${tee.target} with no masked stage right before it, and the public step summary would print the tool's output unmasked; define masked() as age-uat.yml does and write "... | masked | tee -a "$GITHUB_STEP_SUMMARY""`);
        }
      }
    });
  }

  // 9. ::add-mask:: never gets a value shorter than 8 characters
  for (const { where, steps } of stepGroups) {
    steps.forEach((step, index) => {
      if (!isObj(step) || typeof step.run !== "string") return;
      const label = `${where}, step ${index + 1}${typeof step.name === "string" ? ` (${step.name})` : ""}`;
      for (const problem of addMaskProblems(step.run)) add(label, problem);
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
