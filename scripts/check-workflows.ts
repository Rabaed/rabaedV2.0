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
//     workflow inputs, fork repository names) is never written into a run:
//     script, only passed through env. A string workflow_dispatch input is the
//     exception (rule 6): read it from the event file, not from env.
//
// Log rules (RP-1199): the repository is public, and so are its run logs and step summaries.
//
//  6. A string workflow_dispatch input (type: string, the default) is never read through
//     inputs.x, github.event.inputs.x or the whole inputs object in an env:, a step's
//     with: or a run: script; read it with jq on $GITHUB_EVENT_PATH.
//  7. A job that reads a string input starts with a run: step that tests each one for \r
//     or \n (jq test("[\r\n]") on $GITHUB_EVENT_PATH, as age-uat.yml does) and exits 1.
//  8. Under environment: uat, a tee to $GITHUB_STEP_SUMMARY is fed by a `masked` pipe
//     segment, and the step defines masked().
//  9. ::add-mask:: never gets a value shorter than 8 characters: a literal needs 8, a
//     variable a ${#v} test on the same line or the if/[ line right before it.
//
// Exit status (RP-1208):
//
// 10. A run: script with a pipe sets shell: bash on the step, or defaults: run: shell: bash on the job
//     or the workflow. GitHub's default shell is `bash -e {0}`, with no pipefail, so `tool | tee` ends
//     with tee's status and a failed tool shows green; `shell: bash` adds -o pipefail. A `|` inside
//     quotes, a comment, a heredoc body or `||` is not a pipe; PowerShell, cmd and Python steps are left alone.
//
// Out of scope for rules 6 to 9: string inputs in a step name:, container or services env, and a
// reusable workflow's with:; a `>> "$GITHUB_STEP_SUMMARY"` redirect of tool output; tee through a variable.
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

/** A step as a finding names it: its group, its place in the group, and its name. */
function stepLabel(where: string, step: unknown, index: number): string {
  const name = isObj(step) && typeof step.name === "string" ? ` (${step.name})` : "";
  return `${where}, step ${index + 1}${name}`;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** True when the text names `name` as a whole word: not inside a longer name, nor after a backslash (the n of \n). */
const mentions = (text: string, name: string) => new RegExp(String.raw`(?<![\w\\-])${escapeRegExp(name)}(?![\w-])`).test(text);
/** The script without its whole-line comments (the lines stay, so line numbers keep). */
const stripComments = (script: string) => script.replace(/^[ \t]*#.*$/gm, "");
/** The string values of an env or with block. */
const stringValues = (block: unknown): string[] => (isObj(block) ? Object.values(block).filter((value): value is string => typeof value === "string") : []);

/** The workflow_dispatch inputs by name, with their declared type (string when none is given: that is GitHub's default). */
function dispatchInputs(on: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const dispatch = isObj(on) ? on.workflow_dispatch : undefined;
  const inputs = isObj(dispatch) ? dispatch.inputs : undefined;
  if (!isObj(inputs)) return out;
  for (const [name, spec] of Object.entries(inputs)) out.set(name, isObj(spec) && typeof spec.type === "string" ? spec.type : "string");
  return out;
}

/**
 * What the `${{ }}` expressions of a text read of the workflow inputs, lower-cased (contexts are case-insensitive):
 * an input's name, or "*" for the whole inputs object, or the github or github.event object that holds it.
 */
function inputRefs(text: string): string[] {
  const refs: string[] = [];
  for (const expression of text.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
    const body = (expression[1] ?? "").replace(/\[\s*(['"])([^'"]*)\1\s*\]/g, ".$2").toLowerCase();
    for (const ref of body.matchAll(/(?<![\w.-])(?:github\.event\.)?inputs(?![\w-])(?:\.(\*|[\w-]+))?/g)) refs.push(ref[1] ?? "*");
    if (/(?<![\w.-])github(?:\.event)?(?![\w-])(?!\.[\w-])/.test(body)) refs.push("*");
  }
  return refs;
}

/** True when the step's script tests the event file's inputs for \r and \n in one jq test() and exits non-zero. */
function refusesLineBreaks(script: string): boolean {
  const text = stripComments(script).replace(/\\\r?\n/g, " ");
  const tests = text.split("\n").some((line) => {
    if (!/\bjq\b/.test(line) || !/GITHUB_EVENT_PATH/.test(line)) return false;
    return [...line.matchAll(/test\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g)].some(([, regex = ""]) => /\\r/.test(regex) && /\\n/.test(regex));
  });
  return tests && /\bexit\s+[1-9]/.test(text);
}

/**
 * Each `tee` in a script whose arguments name $GITHUB_STEP_SUMMARY, with the last command of the pipe segment right
 * before it. A backslash-newline or a trailing `|` joins lines, so a pipeline written over several lines reads as one.
 */
function teesToSummary(script: string): { target: string; previous: string }[] {
  const joined = script.replace(/\\\r?\n/g, " ").replace(/\|[ \t]*\r?\n/g, "| ");
  const out: { target: string; previous: string }[] = [];
  for (const tee of joined.matchAll(/\btee\b([^\n|;&]*)/g)) {
    const target = /\$\{?GITHUB_STEP_SUMMARY\}?/.exec(tee[1] ?? "")?.[0];
    if (!target) continue;
    const line = joined.slice(joined.lastIndexOf("\n", tee.index) + 1, tee.index);
    const segments = line.split(/(?<!\|)\|(?!\|)/);
    const segment = segments.length > 1 ? (segments[segments.length - 2] ?? "") : "";
    out.push({ target, previous: (segment.split(/;|&&|\|\|/).pop() ?? "").trim() });
  }
  return out;
}

type ShellContext = { kind: "dq" | "backtick" } | { kind: "sub" | "arith" | "param"; depth: number };
/** A heredoc marker at the start of the text (`<<EOF`, `<<-'EOF'`, `<<"EOF"`), not a here-string (`<<<`). */
const heredocMarker = /^<<(-?)[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|\\?([\w.-]+))/;

/**
 * True when a shell script has a pipe: a `|` that is not half of `||`, outside single and double quotes, comments, escapes,
 * heredoc bodies and ${...} expansions (`${v//a|b/c}`). A pipe inside $(...), backticks or "$(...)" counts. `|&` is a
 * pipe. A `case` pattern (`a|b)`) and an alternation in `[[ x =~ a|b ]]` count as pipes too: the fix, shell: bash, is harmless there.
 */
function hasPipe(script: string): boolean {
  const stack: ShellContext[] = [];
  const heredocs: { delimiter: string; stripTabs: boolean }[] = [];
  let i = 0;
  while (i < script.length) {
    const ch = script[i] ?? "";
    const top = stack[stack.length - 1];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "\n" && heredocs.length > 0) {
      // The bodies start on the next line and end on a line holding only the delimiter.
      let at = i + 1;
      for (const { delimiter, stripTabs } of heredocs) {
        while (at < script.length) {
          const end = script.indexOf("\n", at);
          const line = script.slice(at, end === -1 ? script.length : end);
          at = end === -1 ? script.length : end + 1;
          if ((stripTabs ? line.replace(/^\t+/, "") : line) === delimiter) break;
        }
      }
      heredocs.length = 0;
      i = at;
      continue;
    }
    if (ch === "$" && script[i + 1] === "(") {
      // $(( )) is arithmetic: its | is bitwise or and its << a shift, so neither is looked at.
      const arithmetic = script[i + 2] === "(";
      stack.push({ kind: arithmetic ? "arith" : "sub", depth: arithmetic ? 2 : 1 });
      i += arithmetic ? 3 : 2;
      continue;
    }
    if (ch === "$" && script[i + 1] === "{") {
      stack.push({ kind: "param", depth: 1 });
      i += 2;
      continue;
    }
    if (ch === "`") {
      if (top?.kind === "backtick") stack.pop();
      else stack.push({ kind: "backtick" });
      i++;
      continue;
    }
    if (top?.kind === "dq") {
      if (ch === '"') stack.pop();
      i++;
      continue;
    }
    if (ch === '"') {
      stack.push({ kind: "dq" });
      i++;
      continue;
    }
    if (ch === "'") {
      const close = script.indexOf("'", i + 1);
      i = close === -1 ? script.length : close + 1;
      continue;
    }
    if (top?.kind === "param") {
      if (ch === "{") top.depth++;
      else if (ch === "}" && --top.depth === 0) stack.pop();
      i++;
      continue;
    }
    if (top?.kind === "sub" || top?.kind === "arith") {
      if (ch === "(") top.depth++;
      else if (ch === ")" && --top.depth === 0) {
        stack.pop();
        i++;
        continue;
      }
      if (top.kind === "arith") {
        i++;
        continue;
      }
    }
    if (ch === "#" && (i === 0 || /[\s;|&(]/.test(script[i - 1] ?? ""))) {
      const end = script.indexOf("\n", i);
      i = end === -1 ? script.length : end;
      continue;
    }
    if (ch === "<" && script[i + 1] === "<") {
      if (script[i + 2] === "<") {
        i += 3;
        continue;
      }
      const marker = heredocMarker.exec(script.slice(i));
      if (marker) {
        heredocs.push({ delimiter: marker[2] ?? marker[3] ?? marker[4] ?? "", stripTabs: marker[1] === "-" });
        i += marker[0].length;
        continue;
      }
    }
    if (ch === "|") {
      if (script[i + 1] === "|") {
        i += 2;
        continue;
      }
      return true;
    }
    i++;
  }
  return false;
}

/** The shell a `defaults: run: shell:` block names, if any. */
function defaultShell(holder: unknown): string | undefined {
  const defaults = isObj(holder) ? holder.defaults : undefined;
  const run = isObj(defaults) ? defaults.run : undefined;
  return isObj(run) && typeof run.shell === "string" ? run.shell : undefined;
}

const definesMasked = (script: string) => /(?:^|[\s;{(&|])(?:function\s+masked\b|masked\s*\(\s*\))/m.test(script);

/** Shells whose `|` is not bash's: they have no pipefail to ask for. */
const nonBashShell = /^(?:pwsh|powershell|python|cmd)\b/;

const MIN_MASK = 8;
// The parts of an ::add-mask:: value: ${{ }}, $(...), ${...}, $name, $1 or $@, or a plain character.
const maskPart = /\$\{\{[^\n]*?\}\}|\$\([^)\n]*\)|\$\{[^}\n]*\}|\$[A-Za-z_]\w*|\$[0-9@*#?!$-]|[^\s"'`;&|)$]/;

/** How a line compares a variable's length with a number: "enough" when only values of MIN_MASK or more pass, "short" when only shorter ones do. */
function lengthTests(line: string, name: string): ("enough" | "short")[] {
  const out: ("enough" | "short")[] = [];
  for (const [, op = "", digits = "0"] of line.matchAll(new RegExp(String.raw`\$\{#${escapeRegExp(name)}\}"?\s*(-ge|-gt|>=|>|-lt|-le|<=|<)\s*(\d+)`, "g"))) {
    const limit = Number(digits);
    if (((op === "-ge" || op === ">=") && limit >= MIN_MASK) || ((op === "-gt" || op === ">") && limit >= MIN_MASK - 1)) out.push("enough");
    if (((op === "-lt" || op === "<") && limit >= MIN_MASK) || ((op === "-le" || op === "<=") && limit >= MIN_MASK - 1)) out.push("short");
  }
  return out;
}

/**
 * True when the ::add-mask:: on lines[index] runs only for a value of MIN_MASK characters or more: the length test is on
 * that line, or on the `if`/`[`/`((` line right before it (ignoring blank lines), which either opens the branch
 * (ends with `then` or `&&`) or tests for a short value and leaves (exit, continue, return or break).
 */
function maskGuarded(lines: string[], index: number, name: string): boolean {
  if (lengthTests(lines[index] ?? "", name).includes("enough")) return true;
  let before = index - 1;
  while (before >= 0 && (lines[before] ?? "").trim() === "") before--;
  const previous = lines[before] ?? "";
  if (!/^\s*(?:(?:if|elif)\s|\[|\(\()/.test(previous)) return false;
  const tests = lengthTests(previous, name);
  return (tests.includes("enough") && /(?:\bthen|&&)\s*$/.test(previous)) || (tests.includes("short") && /\b(?:exit|continue|return|break)\b/.test(previous));
}

/**
 * What is wrong with the ::add-mask:: commands of one run: script. A command is `::add-mask::` followed by a value; a bare
 * marker (prose in an echoed sentence) is not one. A literal value needs MIN_MASK characters. Every variable in a value
 * needs a length test tied to the mask (maskGuarded); a command substitution, a ${{ }} expression or a special parameter
 * ($@, $*, $#) cannot be tested, so it is assigned to a named variable first.
 */
function addMaskProblems(script: string): string[] {
  const lines = stripComments(script).split("\n");
  const problems = new Set<string>();
  const shortMask = `GitHub masks every occurrence of the value in the public log, so a short or common value (like "2" or "auto") garbles it; mask only values of ${MIN_MASK} characters or more`;
  const guardAdvice = (name: string) => `if [ "\${#${name}}" -ge ${MIN_MASK} ]; then echo "::add-mask::$${name}"; fi`;
  const assignFirst = (value: string) => `gives ::add-mask:: ${value}, which has no named variable whose length can be tested; assign it to a variable and mask it only when its length is ${MIN_MASK} or more (${guardAdvice("v")})`;
  lines.forEach((line, index) => {
    for (const [, value = ""] of line.matchAll(new RegExp(`::add-mask::((?:${maskPart.source})*)`, "g"))) {
      if (value === "") continue;
      let literal = 0;
      let variables = 0;
      for (const [part] of value.matchAll(new RegExp(maskPart.source, "g"))) {
        if (!part.startsWith("$")) {
          literal++;
          continue;
        }
        if (part.startsWith("${{") || part.startsWith("$(")) {
          variables++;
          problems.add(assignFirst(part));
          continue;
        }
        const name = /^\$\{?(#?)([A-Za-z_]\w*|\d+)/.exec(part);
        if (name?.[1] === "#") {
          literal += part.length;
          continue;
        }
        variables++;
        const variable = name?.[2];
        if (!variable) problems.add(`gives ::add-mask:: ${part}, a positional parameter list whose length cannot be tested; copy it to a named variable and mask it only when its length is ${MIN_MASK} or more (${guardAdvice("v")})`);
        else if (!maskGuarded(lines, index, variable)) {
          problems.add(
            /^\d+$/.test(variable)
              ? `gives ::add-mask:: the positional parameter $${variable} with no length test on its line or the if line before it; copy it to a named variable and test its length (${guardAdvice("v")}); ${shortMask}`
              : `gives ::add-mask:: the variable $${variable} with no length test on its line or the if line before it (a non-empty test is not enough); ${shortMask}: ${guardAdvice(variable)}`,
          );
        }
      }
      if (variables === 0 && literal < MIN_MASK) problems.add(`gives ::add-mask:: a literal of ${literal} characters (${MIN_MASK} needed); ${shortMask}`);
    }
  });
  return [...problems];
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
  const stepGroups: { where: string; steps: unknown[]; nodes: unknown[]; job?: Obj }[] = [];
  const jobs = isObj(root.jobs) ? root.jobs : {};
  for (const [id, job] of Object.entries(jobs)) {
    if (isObj(job) && Array.isArray(job.steps)) stepGroups.push({ where: `job ${id}`, steps: job.steps, nodes: stepItems(["jobs", id, "steps"]), job });
  }
  if (isObj(root.runs) && Array.isArray(root.runs.steps)) stepGroups.push({ where: "runs", steps: root.runs.steps, nodes: stepItems(["runs", "steps"]) });

  const checksOut = new Set<string>();
  for (const { where, steps, nodes } of stepGroups) {
    steps.forEach((step, index) => {
      if (!isObj(step)) return;
      const label = stepLabel(where, step, index);
      // 5. Script injection
      if (typeof step.run === "string" && untrustedInScript.test(step.run)) {
        add(label, `writes untrusted text into a run: script (script injection); pass it through env: and read the variable (a string workflow_dispatch input: read it from the event file (jq -r '.inputs.x // ""' "$GITHUB_EVENT_PATH"), as env: prints it in the log)`);
      }
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

  // 6 and 7. String workflow_dispatch inputs stay out of the log
  const stringInputs = [...dispatchInputs(root.on)].filter(([, type]) => type === "string").map(([name]) => name);
  if (stringInputs.length > 0) {
    const byLowerCase = new Map(stringInputs.map((name) => [name.toLowerCase(), name]));
    /** The string inputs a text reads through expressions, by declared name; "*" is the whole inputs object. */
    const readIn = (text: string, except = new Set<string>()) =>
      [...new Set(inputRefs(text).map((ref) => (ref === "*" ? ref : byLowerCase.get(ref))))].filter((name): name is string => name !== undefined && !except.has(name));
    const fromEventFile = (name: string) => `jq -r '.inputs.${name} // ""' "$GITHUB_EVENT_PATH"`;
    const leak = (where: string, place: string, text: string, except = new Set<string>()) => {
      for (const name of readIn(text, except)) {
        add(
          where,
          name === "*"
            ? `puts every input, the string inputs ${stringInputs.join(", ")} among them, in ${place}, which the public run log prints; read the one you need from the event file: ${fromEventFile(stringInputs[0] ?? "x")}`
            : `puts the string input "${name}" in ${place}, which the public run log prints; read it from the event file: ${fromEventFile(name)} (or make the input a choice, boolean or number)`,
        );
      }
    };
    leak("workflow env", "the workflow's env:", stringValues(root.env).join("\n"));
    for (const [id, job] of Object.entries(jobs)) if (isObj(job)) leak(`job ${id}`, "the job's env:", stringValues(job.env).join("\n"));
    for (const { where, steps } of stepGroups) {
      steps.forEach((step, index) => {
        if (!isObj(step)) return;
        const label = stepLabel(where, step, index);
        leak(label, "the step's env:", stringValues(step.env).join("\n"));
        leak(label, "the step's with:", stringValues(step.with).join("\n"));
        if (typeof step.run === "string") {
          // Rule 5 reports a whole ${{ inputs.x }}; leave those names to it and report the rest.
          const wholeExpression = [...step.run.matchAll(/\$\{\{\s*(?:github\.event\.)?inputs\.([\w-]+)\s*\}\}/g)].map(([, name = ""]) => byLowerCase.get(name.toLowerCase()) ?? "");
          leak(label, "a run: script", step.run, new Set(wholeExpression));
        }
      });
    }

    // 7. A job that reads a string input refuses a carriage return or newline first
    const workflowEnvReads = readIn(stringValues(root.env).join("\n")).length > 0;
    for (const { where, steps, job } of stepGroups) {
      if (!job) continue;
      const texts = steps.map((step) => (isObj(step) ? [typeof step.run === "string" ? stripComments(step.run) : "", ...stringValues(step.with), ...stringValues(step.env)].join("\n") : ""));
      const readsEventFile = texts.some((text) => /GITHUB_EVENT_PATH/.test(text) && /\.inputs\b|github\.event\.inputs/.test(text));
      const reads = workflowEnvReads || readIn(stringValues(job.env).join("\n")).length > 0 || readsEventFile || texts.some((text) => readIn(text).length > 0);
      if (!reads) continue;
      const named = stringInputs.filter((name) => texts.some((text) => mentions(text, name)));
      const required = named.length > 0 ? named : stringInputs;
      const first = steps[0];
      const firstRun = isObj(first) && typeof first.run === "string" ? stripComments(first.run) : "";
      if (!refusesLineBreaks(firstRun)) {
        add(
          where,
          `reads string inputs (${required.join(", ")}) but its first step does not refuse a carriage return or newline in them, so a multi-line input would print its later lines unmasked in the public log; make step 1 a run: that tests each one in the event file (jq -e --arg k "$key" '(.inputs[$k] // "") | test("[\\r\\n]")' "$GITHUB_EVENT_PATH") and exits 1, as age-uat.yml does`,
        );
        continue;
      }
      const skipped = required.filter((name) => !mentions(firstRun, name));
      if (skipped.length > 0) add(where, `refuses a carriage return or newline in its first step but skips the string input${skipped.length > 1 ? "s" : ""} ${skipped.join(", ")}; test every string input the job reads in that step`);
    }
  }

  // 8. A tee to the step summary under environment uat goes through masked
  for (const { where, steps, job } of stepGroups) {
    const environment = isObj(job?.environment) ? job.environment.name : job?.environment;
    if (environment !== "uat") continue;
    steps.forEach((step, index) => {
      if (!isObj(step) || typeof step.run !== "string") return;
      const script = stripComments(step.run);
      const tees = teesToSummary(script);
      const label = stepLabel(where, step, index);
      for (const tee of tees.filter((candidate) => candidate.previous !== "masked")) {
        add(label, `pipes to tee ${tee.target} without a masked stage right before it, so the public step summary would print the tool's output unmasked; define masked() as age-uat.yml does and write '... | masked | tee -a "$GITHUB_STEP_SUMMARY"'`);
      }
      if (tees.some((tee) => tee.previous === "masked") && !definesMasked(script)) add(label, "pipes to tee through masked but never defines it, so the step would fail with command not found; define masked() in the same step, as age-uat.yml does");
    });
  }

  // 9. ::add-mask:: never gets a value shorter than 8 characters
  for (const { where, steps } of stepGroups) {
    steps.forEach((step, index) => {
      if (!isObj(step) || typeof step.run !== "string") return;
      for (const problem of addMaskProblems(step.run)) add(stepLabel(where, step, index), problem);
    });
  }

  // 10. A run: script with a pipe runs under an explicit shell: bash (pipefail)
  for (const { where, steps, job } of stepGroups) {
    steps.forEach((step, index) => {
      if (!isObj(step) || typeof step.run !== "string") return;
      const shell = typeof step.shell === "string" ? step.shell : (defaultShell(job) ?? defaultShell(root));
      if (shell === "bash" || (shell !== undefined && nonBashShell.test(shell))) return;
      if (!hasPipe(step.run)) return;
      add(
        stepLabel(where, step, index),
        `has a pipe in a run: script but ${shell === undefined ? "no shell:" : `shell: ${shell}`}, so it runs without pipefail (GitHub's default is bash -e, and sh has none either): a failing tool before the pipe shows green because the step ends with the last command's status; set shell: bash on the step, or defaults: run: shell: bash on the job or the workflow (GitHub then adds -o pipefail)`,
      );
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
