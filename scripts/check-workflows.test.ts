import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { lintRepository, lintWorkflow } from "./check-workflows.ts";

const SHA = "ea17c68df8912ef543352723c149a84f56e3d413";
const messages = (source: string) => lintWorkflow("w.yml", source).map((f) => `${f.where}: ${f.message}`);

const safe = (extra = "") => `
on: push
permissions: { contents: read }
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with: { persist-credentials: false }
${extra}`;

describe("lintWorkflow", () => {
  it("passes a hardened workflow", () => {
    expect(messages(safe(`      - uses: pnpm/action-setup@${SHA} # v6.1.0`))).toEqual([]);
  });

  describe("persist-credentials", () => {
    it("flags a checkout that leaves credentials persisted", () => {
      const found = messages("on: push\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@v7\n");
      expect(found).toHaveLength(1);
      expect(found[0]).toContain("persist-credentials");
    });

    it("flags persist-credentials: true", () => {
      expect(messages("on: push\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@v7\n        with:\n          persist-credentials: true\n")).toHaveLength(1);
    });

    it("accepts a comment above the step that gives the reason", () => {
      const source = "on: push\njobs:\n  a:\n    steps:\n      - run: echo\n      # keeps credentials: the push below needs them.\n      - uses: actions/checkout@v7\n";
      expect(messages(source)).toEqual([]);
    });

    it("rejects a vague comment, or a marker with no reason", () => {
      for (const comment of ["# TODO credentials", "# keeps credentials:", "# keeps credentials:   "]) {
        const source = `on: push\njobs:\n  a:\n    steps:\n      ${comment}\n      - uses: actions/checkout@v7\n`;
        expect(messages(source)).toHaveLength(1);
      }
    });

    it("does not take another step's comment as the reason", () => {
      const source = "on: push\njobs:\n  a:\n    steps:\n      # Credentials are fine here.\n      - run: echo\n      - uses: actions/checkout@v7\n";
      expect(messages(source)).toHaveLength(1);
    });
  });

  it("flags pull_request_target in any form", () => {
    for (const on of ["pull_request_target", "[push, pull_request_target]", "\n  pull_request_target:\n    types: [labeled]"]) {
      expect(messages(`on: ${on}\njobs: {}\n`).join()).toContain("pull_request_target");
    }
  });

  describe("write tokens and fork code", () => {
    const run = (jobs: string, on = "workflow_run: { workflows: [CI] }") => messages(`on:\n  ${on}\npermissions: {}\njobs:\n${jobs}`);
    const checkout = "      - uses: actions/checkout@v7\n        with: { persist-credentials: false }\n";

    it("flags a write job that checks out code with no same-repository guard", () => {
      const found = run(`  a:\n    permissions: { contents: write }\n    steps:\n${checkout}`);
      expect(found).toHaveLength(1);
      expect(found[0]).toContain("job a");
    });

    it("accepts the guard on the job, or on a job it needs", () => {
      const guard = "github.event.workflow_run.head_repository.full_name == github.repository";
      expect(run(`  a:\n    if: ${guard}\n    permissions: { contents: write }\n    steps:\n${checkout}`)).toEqual([]);
      expect(run(`  f:\n    if: ${guard}\n  a:\n    needs: [f]\n    permissions: { contents: write }\n    steps:\n${checkout}`)).toEqual([]);
    });

    it("accepts the pull_request form of the guard", () => {
      const job = `  a:\n    if: github.event.pull_request.head.repo.full_name == github.repository\n    permissions: { id-token: write }\n    steps:\n${checkout}`;
      expect(run(job, "pull_request:")).toEqual([]);
    });

    it("takes a guard on an unrelated job as no guard", () => {
      const guard = "github.event.workflow_run.head_repository.full_name == github.repository";
      expect(run(`  f:\n    if: ${guard}\n  a:\n    permissions: { contents: write }\n    steps:\n${checkout}`)).toHaveLength(1);
    });

    it("uses the workflow's permissions when the job sets none", () => {
      expect(messages(`on: workflow_run\npermissions: write-all\njobs:\n  a:\n    steps:\n${checkout}`)).toHaveLength(1);
    });

    it("ignores read-only jobs, jobs without a checkout, and workflows nothing external starts", () => {
      expect(run(`  a:\n    permissions: { contents: read }\n    steps:\n${checkout}`)).toEqual([]);
      expect(run("  a:\n    permissions: { pull-requests: write }\n    steps:\n      - run: gh pr edit\n")).toEqual([]);
      expect(messages(`on: [push, workflow_dispatch]\njobs:\n  a:\n    permissions: { contents: write }\n    steps:\n${checkout}`)).toEqual([]);
    });
  });

  describe("pinning", () => {
    it("flags a third-party action on a tag or branch", () => {
      const found = messages(safe("      - uses: docker/setup-buildx-action@v4\n      - uses: some/thing@main\n"));
      expect(found).toHaveLength(2);
      expect(found[0]).toContain("docker/setup-buildx-action@v4");
    });

    it("accepts actions/ and github/ on tags, local actions, and a SHA", () => {
      expect(messages(safe("      - uses: actions/setup-node@v7\n      - uses: github/codeql-action/init@v3\n      - uses: ./.github/actions/test-timing\n"))).toEqual([]);
    });

    it("flags a short SHA", () => {
      expect(messages(safe("      - uses: pnpm/action-setup@ea17c68\n"))).toHaveLength(1);
    });

    it("flags a Docker image without a digest", () => {
      expect(messages(safe("      - uses: docker://alpine:3.20\n"))).toHaveLength(1);
      expect(messages(safe(`      - uses: docker://alpine@sha256:${"a".repeat(64)}\n`))).toEqual([]);
    });

    it("checks the steps of a composite action", () => {
      const source = "name: x\nruns:\n  using: composite\n  steps:\n    - uses: some/thing@v1\n";
      expect(messages(source)).toHaveLength(1);
    });
  });

  describe("script injection", () => {
    it("flags untrusted text written into a run script", () => {
      expect(messages(safe("      - run: echo ${{ github.head_ref }}\n"))).toHaveLength(1);
      expect(messages(safe("      - run: echo '${{ github.event.workflow_run.head_branch }}'\n"))).toHaveLength(1);
    });

    it("flags inputs, commit author and message, and head repository fields", () => {
      const exprs = [
        "inputs.name",
        "github.event.inputs.name",
        "github.event.head_commit.author.name",
        "github.event.head_commit.author.email",
        "github.event.head_commit.message",
        "github.event.pull_request.head.repo.full_name",
        "github.event.pull_request.head.repo.name",
        "github.event.workflow_run.head_commit.author.email",
        "github.event.workflow_run.head_repository.full_name",
        "github.event.workflow_run.pull_requests[0].head.ref",
      ];
      for (const expr of exprs) {
        expect(messages(safe("      - run: echo ${{ " + expr + " }}\n")), expr).toHaveLength(1);
      }
    });

    it("accepts inputs passed through env", () => {
      expect(messages(safe('      - run: echo "$NAME"\n        env: { NAME: "${{ inputs.name }}" }\n'))).toEqual([]);
    });

    it("accepts it passed through env", () => {
      expect(messages(safe('      - run: echo "$BRANCH"\n        env: { BRANCH: "${{ github.head_ref }}" }\n'))).toEqual([]);
    });
  });

  it("reports invalid YAML", () => {
    expect(messages("on: [unclosed\n").join()).toContain("not valid YAML");
  });
});

// Log rules (RP-1199). The repository is public, and so are its run logs and step summaries: one UAT
// workflow took six PRs to stop tester data leaking into them, through a tool's output, an input's env: line
// and the step summary. The fixtures use generic names (alpha and beta are string inputs).
const indent = (script: string, spaces = 10) =>
  script
    .split("\n")
    .map((line) => " ".repeat(spaces) + line)
    .join("\n");
const dispatch = (inputs: string, jobs: string, top = "") => `on:\n  workflow_dispatch:\n    inputs:\n${inputs}\n${top}permissions: { contents: read }\njobs:\n${jobs}`;
const job = (steps: string, extra = "") => `  a:\n    runs-on: ubuntu-latest\n${extra}    steps:\n${steps}`;
const stringInput = "      alpha:\n        type: string\n";
const untypedInput = "      alpha:\n        description: no type, so a string\n";
const secondString = "      beta:\n        type: string\n";
const choiceInput = "      mode:\n        type: choice\n        options: [a, b]\n";
const boolInput = "      flag:\n        type: boolean\n";
const numberInput = "      count:\n        type: number\n";
const checkout = "      - uses: actions/checkout@v7\n        with: { persist-credentials: false }\n";
/** age-uat.yml's first step, for the named inputs. */
const refusal = (keys = "alpha") =>
  [
    "      - name: Refuse line breaks",
    "        run: |",
    indent(
      [
        `for key in ${keys}; do`,
        `  if jq -e --arg k "$key" '(.inputs[$k] // "") | test("[\\r\\n]")' "$GITHUB_EVENT_PATH" > /dev/null; then`,
        '    echo "::error::$key takes one line only"',
        "    exit 1",
        "  fi",
        "done",
      ].join("\n"),
    ),
  ].join("\n") + "\n";
const readAlpha = '      - run: jq -r \'.inputs.alpha // ""\' "$GITHUB_EVENT_PATH"\n';

describe("rule 6: a string workflow_dispatch input stays out of env, with and run", () => {
  const leak = (inputs: string, step: string, jobExtra = "", top = "") => messages(dispatch(inputs, job(refusal("alpha beta") + step, jobExtra), top));
  const inEnv = (value: string) => `      - run: echo hi\n        env:\n          V: ${JSON.stringify(value)}\n`;
  const inRun = (script: string) => `      - run: ${JSON.stringify(script)}\n`;
  const readFromEventFile = `jq -r '.inputs.alpha // ""' "$GITHUB_EVENT_PATH"`;

  it("flags a named string input in a step's env, however the expression spells it", () => {
    const spellings = [
      "inputs.alpha",
      "github.event.inputs.alpha",
      "inputs['alpha']",
      'inputs["alpha"]',
      "github['event']['inputs']['alpha']",
      "github.event['inputs'].alpha",
      "INPUTS.alpha",
      "Github.Event.Inputs.ALPHA",
      "inputs.alpha || 'x'",
    ];
    for (const spelling of spellings) {
      const found = leak(stringInput + secondString, inEnv("${{ " + spelling + " }}"));
      expect(found, spelling).toHaveLength(1);
      expect(found[0], spelling).toContain(`the string input "alpha"`);
      expect(found[0], spelling).toContain(`read it from the event file: ${readFromEventFile}`);
    }
  });

  it("flags the whole inputs object, and the objects that hold it", () => {
    const wholes = ["toJSON(github.event.inputs)", "toJSON(inputs)", "inputs.*", "github.event.inputs.*", "toJSON(github.event)", "toJSON(github)", "format('{0}', inputs)"];
    for (const whole of wholes) {
      const found = leak(stringInput + secondString, inEnv("${{ " + whole + " }}"));
      expect(found, whole).toHaveLength(1);
      expect(found[0], whole).toContain("every input, the string inputs alpha, beta among them");
      expect(found[0], whole).toContain(`read the one you need from the event file: ${readFromEventFile}`);
    }
  });

  it("treats an input with no type as a string, and checks job, workflow and with: too", () => {
    const expr = "${{ inputs.alpha }}";
    expect(leak(untypedInput, inEnv(expr))).toHaveLength(1);
    expect(leak(stringInput, "      - run: echo hi\n", `    env:\n      V: ${JSON.stringify(expr)}\n`)).toHaveLength(1);
    expect(leak(stringInput, "      - run: echo hi\n", "", `env:\n  V: ${JSON.stringify(expr)}\n`)).toHaveLength(1);
    const withKey = `      - uses: actions/cache@v4\n        with:\n          key: ${JSON.stringify(expr)}\n`;
    const found = leak(stringInput, withKey);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("with:");
  });

  it("flags a string input in a run script written as anything but rule 5's whole expression", () => {
    expect(leak(stringInput, inRun("test \"${{ inputs.alpha == 'x' && 1 || 0 }}\" = 1"))).toHaveLength(1);
    expect(leak(stringInput, inRun("echo '${{ toJSON(inputs) }}'"))).toHaveLength(1);
  });

  it("leaves a whole ${{ inputs.x }} in run to rule 5, and still reports a second input beside it", () => {
    const alone = leak(stringInput + secondString, inRun("echo ${{ inputs.alpha }}"));
    expect(alone).toHaveLength(1);
    expect(alone[0]).toContain("untrusted text");
    const both = leak(stringInput + secondString, inRun("echo ${{ inputs.alpha }} ${{ inputs.beta == 'x' }}"));
    expect(both).toHaveLength(2);
    expect(both.some((found) => found.includes(`the string input "beta"`))).toBe(true);
  });

  it("accepts choice, boolean and number inputs in env, and a string input in a job if:", () => {
    const others = choiceInput + boolInput + numberInput;
    for (const spelling of ["inputs.mode", "INPUTS.flag", "github.event.inputs.count", "inputs.mode == 'a'"]) {
      expect(messages(dispatch(others, job("      - run: echo hi\n        env:\n          V: ${{ " + spelling + " }}\n"))), spelling).toEqual([]);
    }
    expect(messages(dispatch(others, job(inEnv("${{ toJSON(inputs) }}"))))).toEqual([]);
    const ifOnly = job("      - run: echo hi\n", "    if: inputs.alpha == 'x'\n");
    expect(messages(dispatch(stringInput, ifOnly))).toEqual([]);
  });

  it("does not take github.event_name or github.repository for the inputs object", () => {
    const step = "      - run: echo hi\n        env:\n          E: ${{ github.event_name }}\n          R: ${{ github.repository }}\n";
    expect(messages(dispatch(stringInput, job(refusal() + step)))).toEqual([]);
  });

  it("leaves a composite action's own inputs alone", () => {
    const source = "name: x\ninputs:\n  alpha:\n    default: ''\nruns:\n  using: composite\n  steps:\n    - shell: bash\n      run: echo hi\n      env:\n        W: ${{ inputs.alpha }}\n";
    expect(messages(source)).toEqual([]);
  });

  it("tells a dispatch string input to be read from the event file, in rule 5's message too", () => {
    const found = messages(safe("      - run: echo ${{ github.head_ref }}\n"));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(`a string workflow_dispatch input: read it from the event file (${readFromEventFile.replace("alpha", "x")})`);
  });
});

describe("rule 7: a job that reads string inputs refuses a carriage return or newline in its first step", () => {
  const found = (steps: string, inputs = stringInput) => messages(dispatch(inputs, job(steps)));
  const firstStepAdvice = "make step 1 a run: that tests each one in the event file";

  it("passes when the first step tests every string input in the event file and exits 1", () => {
    expect(found(refusal() + checkout + readAlpha)).toEqual([]);
  });

  it("flags a reading job whose first step is not a refusal", () => {
    const missing = found(checkout + readAlpha);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain("job a");
    expect(missing[0]).toContain(firstStepAdvice);
    expect(found("      - run: echo hi\n" + readAlpha)).toHaveLength(1);
    expect(found(checkout + refusal() + readAlpha)).toHaveLength(1);
  });

  it("flags a first step that skips a string input the job reads", () => {
    const two = stringInput + secondString;
    const skipped = found(refusal("alpha") + readAlpha + "      - run: jq -r '.inputs.beta' \"$GITHUB_EVENT_PATH\"\n", two);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toContain("skips the string input beta");
  });

  it("flags a first step that tests only one of the two characters, never exits, or exits 0", () => {
    expect(found(refusal().replace("\\r", "") + readAlpha)).toHaveLength(1);
    expect(found(refusal().replace("exit 1", "echo no") + readAlpha)).toHaveLength(1);
    expect(found(refusal().replace("exit 1", "exit 0") + readAlpha)).toHaveLength(1);
  });

  it("takes words in comments for nothing", () => {
    const commented = ["      - run: |", indent(['# jq -e \'.inputs.alpha | test("[\\r\\n]")\' "$GITHUB_EVENT_PATH" || exit 1', 'jq -r .inputs.alpha "$GITHUB_EVENT_PATH"'].join("\n"))].join("\n") + "\n";
    expect(found(commented + readAlpha)).toHaveLength(1);
  });

  it("does not take an unrelated newline, a jq of the event file and exit 0 for a refusal", () => {
    const unrelated = ["      - run: |", indent(["printf '\\n'", 'jq .inputs.alpha "$GITHUB_EVENT_PATH"', "exit 0"].join("\n"))].join("\n") + "\n";
    const flagged = found(unrelated + readAlpha);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toContain(firstStepAdvice);
  });

  it("asks nothing of a job that reads no input, nor of an input only compared in an if:", () => {
    const confirm = "      confirm:\n        type: string\n";
    const jobs = `  stop:\n    if: inputs.confirm != 'go'\n    runs-on: ubuntu-latest\n    steps:\n      - run: exit 1\n  go:\n    if: inputs.confirm == 'go'\n    runs-on: ubuntu-latest\n    steps:\n${checkout}`;
    expect(messages(dispatch(confirm, jobs))).toEqual([]);
    const reader = job(refusal() + readAlpha).replace("  a:", "  c:");
    expect(messages(dispatch(confirm + stringInput, jobs + reader))).toEqual([]);
  });

  it("ignores choice and boolean inputs read from the event file", () => {
    expect(found('      - run: jq -r \'.inputs.mode\' "$GITHUB_EVENT_PATH"\n', choiceInput + boolInput)).toEqual([]);
  });

  it("asks for every string input when the job reads the whole inputs object", () => {
    const whole = found('      - run: jq .inputs "$GITHUB_EVENT_PATH"\n');
    expect(whole).toHaveLength(1);
    expect(whole[0]).toContain("alpha");
  });

  it("does not take an input named n or r for the \\n and \\r of the test, and escapes odd names", () => {
    const odd = stringInput + "      n:\n        type: string\n      r:\n        type: string\n";
    expect(found(refusal() + readAlpha, odd)).toEqual([]);
    const plus = stringInput + '      "a+b":\n        type: string\n';
    const readPlus = '      - run: jq -r \'.inputs."a+b"\' "$GITHUB_EVENT_PATH"\n';
    expect(found(refusal("alpha a+b") + readAlpha + readPlus, plus)).toEqual([]);
    const skipped = found(refusal("alpha") + readAlpha + readPlus, plus);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toContain("a+b");
  });
});

describe("rule 8: a tee to the step summary under environment uat goes through masked", () => {
  const maskedFunction = "masked() { sed -E 's/[^[:space:]]+@[^[:space:]]+/<email>/g'; }\n";
  const uat = (run: string, { define = true, environment = "environment: uat\n    " } = {}) =>
    `on: push\npermissions: { contents: read }\njobs:\n  a:\n    ${environment}runs-on: ubuntu-latest\n    steps:\n      - shell: bash\n        run: |\n${indent((define ? maskedFunction : "") + run)}\n`;
  const missingStage = `without a masked stage right before it`;
  const piped = `write '... | masked | tee -a "$GITHUB_STEP_SUMMARY"'`;

  it("passes a pipe whose stage right before the tee is masked", () => {
    expect(messages(uat('node tool.ts 2>&1 | masked | tee -a "$GITHUB_STEP_SUMMARY"'))).toEqual([]);
    expect(messages(uat("node tool.ts | masked | tee -a $GITHUB_STEP_SUMMARY"))).toEqual([]);
    expect(messages(uat('node tool.ts 2>&1 \\\n  | masked \\\n  | tee -a "${GITHUB_STEP_SUMMARY}"'))).toEqual([]);
    expect(messages(uat('node tool.ts |\n  masked |\n  tee -a "$GITHUB_STEP_SUMMARY"'))).toEqual([]);
  });

  it("flags a tee to the summary with no masked pipe segment right before it", () => {
    const bad = [
      'node tool.ts | tee -a "$GITHUB_STEP_SUMMARY"',
      "node tool.ts | tee $GITHUB_STEP_SUMMARY",
      'masked | node tool.ts | tee -a "$GITHUB_STEP_SUMMARY"',
      'node tool.ts | sed s/a/b/ | tee -a "$GITHUB_STEP_SUMMARY"',
      'node tool.ts 2>&1 \\\n  | tee -a "$GITHUB_STEP_SUMMARY"',
      'masked; node tool.ts | tee "$GITHUB_STEP_SUMMARY"',
      'echo masked && node tool.ts | tee "$GITHUB_STEP_SUMMARY"',
      'node tool.ts | masked_not | tee "$GITHUB_STEP_SUMMARY"',
    ];
    for (const run of bad) {
      const found = messages(uat(run));
      expect(found, run).toHaveLength(1);
      expect(found[0], run).toContain(missingStage);
      expect(found[0], run).toContain(piped);
    }
  });

  it("flags masked used but never defined in the step", () => {
    const found = messages(uat('node tool.ts | masked | tee -a "$GITHUB_STEP_SUMMARY"', { define: false }));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("never defines it");
    expect(found[0]).toContain("define masked() in the same step");
  });

  it("accepts masked defined as masked (), function masked or masked() in a one-liner", () => {
    const tee = 'node tool.ts | masked | tee -a "$GITHUB_STEP_SUMMARY"';
    for (const definition of ["masked () { cat; }", "function masked { cat; }", "function masked() { cat; }", "x=1; masked() { cat; }"]) {
      expect(messages(uat(`${definition}\n${tee}`, { define: false })), definition).toEqual([]);
    }
  });

  it("takes a definition or a pipe that sits only in a comment for nothing", () => {
    const tee = 'node tool.ts | masked | tee -a "$GITHUB_STEP_SUMMARY"';
    expect(messages(uat(`# masked() { cat; }\n${tee}`, { define: false }))).toHaveLength(1);
    expect(messages(uat('# node tool.ts | tee -a "$GITHUB_STEP_SUMMARY"'))).toEqual([]);
  });

  it("does not flag plain echo of fixed text, a tee to another file, or a job outside environment uat", () => {
    expect(messages(uat('echo "### Deployed" >> "$GITHUB_STEP_SUMMARY"'))).toEqual([]);
    expect(messages(uat("node tool.ts | tee out.log"))).toEqual([]);
    expect(messages(uat('node tool.ts | tee -a "$GITHUB_STEP_SUMMARY"', { environment: "" }))).toEqual([]);
    expect(messages(uat('node tool.ts | tee -a "$GITHUB_STEP_SUMMARY"', { environment: "environment: { name: other }\n    " }))).toEqual([]);
  });

  it("recognises environment uat given as a mapping", () => {
    expect(messages(uat('node tool.ts | tee -a "$GITHUB_STEP_SUMMARY"', { environment: "environment: { name: uat }\n    " }))).toHaveLength(1);
  });
});

describe("rule 9: ::add-mask:: is never given a value shorter than 8 characters", () => {
  const mask = (script: string) => messages(`on: push\npermissions: { contents: read }\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n${indent(script)}\n`);
  const guardAdvice = 'if [ "${#v}" -ge 8 ]; then echo "::add-mask::$v"; fi';
  const shortAdvice = "mask only values of 8 characters or more";

  it("passes a literal of 8 or more characters, and a variable length-tested on its own line or the if line before", () => {
    expect(mask("echo ::add-mask::12345678")).toEqual([]);
    for (const script of [
      'v="$(get)"\nif [ "${#v}" -ge 8 ]; then echo "::add-mask::$v"; fi',
      'v="$(get)"\nif [[ ${#v} -ge 8 ]]; then echo "::add-mask::${v}"; fi',
      'v="$(get)"\nif [ ${#v} -gt 7 ]; then echo "::add-mask::$v"; fi',
      'v="$(get)"\nif (( ${#v} >= 12 )); then echo "::add-mask::$v"; fi',
      'v="$(get)"\n[ "${#v}" -ge 8 ] && echo "::add-mask::$v"',
      'v="$(get)"\nif [ "${#v}" -ge 8 ]; then\n  echo "::add-mask::$v"\nfi',
      'v="$(get)"\nif [ "${#v}" -ge 8 ]; then\n\n  echo "::add-mask::$v"\nfi',
    ]) {
      expect(mask(script), script).toEqual([]);
    }
  });

  it("accepts a short value skipped by an early continue, return, break or exit on the line before", () => {
    for (const exit of ["continue", "return 0", "break", "exit 0"]) {
      expect(mask(`v="$(get)"\n[ "\${#v}" -lt 8 ] && ${exit}\necho "::add-mask::$v"`), exit).toEqual([]);
    }
    expect(mask('v="$(get)"\nif (( ${#v} <= 7 )); then continue; fi\necho "::add-mask::$v"')).toEqual([]);
    // Without a way out, the short value is still masked.
    expect(mask('v="$(get)"\n[ "${#v}" -lt 8 ] && echo short\necho "::add-mask::$v"')).toHaveLength(1);
    expect(mask('v="$(get)"\n[ "${#v}" -lt 4 ] && continue\necho "::add-mask::$v"')).toHaveLength(1);
  });

  it("flags a literal shorter than 8 characters", () => {
    for (const script of ["echo ::add-mask::auto", 'echo "::add-mask::2"', "echo '::add-mask::1234567'"]) {
      const found = mask(script);
      expect(found, script).toHaveLength(1);
      expect(found[0], script).toContain(shortAdvice);
    }
  });

  it("flags a variable with no length test, a weak one, or one on another line or for another variable", () => {
    for (const script of [
      'v="$(get)"\nif [ -n "$v" ]; then echo "::add-mask::$v"; fi',
      'v="$(get)"\nif [ "${#v}" -ge 4 ]; then echo "::add-mask::$v"; fi',
      'v="$(get)"\nif [ "${#v}" -gt 3 ]; then echo "::add-mask::$v"; fi',
      'echo "::add-mask::${v}"',
      'other=x\nif [ "${#other}" -ge 8 ]; then echo "::add-mask::$v"; fi',
      // the test is elsewhere in the script, not tied to the mask
      'v="$(get)"\n[ "${#v}" -ge 8 ] || exit 1\necho hi\necho "::add-mask::$v"',
      'if [ "${#v}" -ge 8 ]; then echo ok; fi\necho "::add-mask::$v"',
      // a comment is not a test
      'v="$(get)"\n# if [ "${#v}" -ge 8 ]; then\necho "::add-mask::$v"',
    ]) {
      const found = mask(script);
      expect(found, script).toHaveLength(1);
      expect(found[0], script).toContain(shortAdvice);
      expect(found[0], script).toContain(guardAdvice);
    }
  });

  it("flags a command substitution or expression, which has no variable to test", () => {
    for (const script of ['echo "::add-mask::$(node tool.ts bypass)"', 'echo "::add-mask::${{ secrets.TOKEN }}"']) {
      const found = mask(script);
      expect(found, script).toHaveLength(1);
      expect(found[0], script).toContain("assign it to a variable and mask it only when its length is 8 or more");
    }
  });

  it("flags a positional or special parameter, which a name cannot be tested for", () => {
    const positional = mask('echo "::add-mask::$1"');
    expect(positional).toHaveLength(1);
    expect(positional[0]).toContain("positional parameter $1");
    expect(positional[0]).toContain("copy it to a named variable");
    expect(mask('if [ "${#1}" -ge 8 ]; then echo "::add-mask::$1"; fi')).toEqual([]);
    for (const special of ["$@", "$*", "$#"]) {
      const found = mask(`echo "::add-mask::${special}"`);
      expect(found, special).toHaveLength(1);
      expect(found[0], special).toContain("positional parameter");
      expect(found[0], special).not.toContain("literal");
    }
  });

  it("checks every variable of a value like $a$b", () => {
    const one = mask('if [ "${#a}" -ge 8 ]; then echo "::add-mask::$a$b"; fi');
    expect(one).toHaveLength(1);
    expect(one[0]).toContain("$b");
    expect(mask('if [ "${#a}" -ge 8 ] && [ "${#b}" -ge 8 ]; then echo "::add-mask::$a$b"; fi')).toEqual([]);
    expect(mask('if [ "${#a}" -ge 8 ]; then echo "::add-mask::${a}-$(date)"; fi')).toHaveLength(1);
  });

  it("does not take the marker inside an echoed sentence, or in a comment, for a command", () => {
    // A command carries a value right after the marker; a bare marker is prose.
    expect(mask('echo "::error::never write ::add-mask:: with a short value"')).toEqual([]);
    expect(mask('# echo "::add-mask::1"')).toEqual([]);
  });

  it("says so once for a value masked twice, and once for each different one", () => {
    expect(mask('echo "::add-mask::$v"\necho "::add-mask::$v"')).toHaveLength(1);
    expect(mask('echo "::add-mask::$a"\necho "::add-mask::$b"')).toHaveLength(2);
  });
});

// Rule 10 (RP-1208): GitHub's default shell is `bash -e {0}`, with no pipefail, so `tool | tee` ends with tee's exit
// status and a failed tool shows green. An explicit `shell: bash` runs `bash --noprofile --norc -eo pipefail {0}`.
describe("rule 10: a run: script with a pipe sets shell: bash", () => {
  const pipefail = "pipefail";
  const advice = "shell: bash";
  const wf = (step: string, { jobExtra = "", top = "" } = {}) => `on: push\npermissions: { contents: read }\n${top}jobs:\n  a:\n    runs-on: ubuntu-latest\n${jobExtra}    steps:\n${step}`;
  const runOf = (script: string, stepExtra = "") => `      - ${stepExtra}run: |\n${indent(script)}\n`;
  const piped = "node tool.ts | tee out.log";

  it("flags a pipe with no shell at all, and names the step and the fix", () => {
    const found = messages(wf(runOf(piped)));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("job a, step 1");
    expect(found[0]).toContain(pipefail);
    expect(found[0]).toContain(advice);
    expect(found[0]).toContain("defaults: run: shell: bash");
  });

  it("flags a one-line run: and a pipe on a later line, once per step", () => {
    expect(messages(wf("      - run: node tool.ts | tee out.log\n"))).toHaveLength(1);
    expect(messages(wf(runOf("echo hi\nnode tool.ts | sort | tee out.log\necho done")))).toHaveLength(1);
  });

  it("flags every piped step, not only the first", () => {
    expect(messages(wf(runOf(piped) + runOf("echo hi") + runOf("a | b")))).toHaveLength(2);
  });

  it("flags a pipe written over several lines, a pipe after a heredoc marker, and |&", () => {
    expect(messages(wf(runOf("node tool.ts 2>&1 \\\n  | tee out.log")))).toHaveLength(1);
    expect(messages(wf(runOf("node tool.ts |\n  tee out.log")))).toHaveLength(1);
    expect(messages(wf(runOf("cat <<EOF | tee out.log\nbody\nEOF")))).toHaveLength(1);
    expect(messages(wf(runOf("node tool.ts |& tee out.log")))).toHaveLength(1);
  });

  it("flags a pipe inside a command substitution, in quotes or not", () => {
    expect(messages(wf(runOf('v="$(node tool.ts | head -n 1)"')))).toHaveLength(1);
    expect(messages(wf(runOf("v=$(node tool.ts | head -n 1)")))).toHaveLength(1);
    expect(messages(wf(runOf("v=`node tool.ts | head -n 1`")))).toHaveLength(1);
    expect(messages(wf(runOf('v="${x:-$(node tool.ts | head -n 1)}"')))).toHaveLength(1);
  });

  it("passes shell: bash on the step, the job or the workflow", () => {
    expect(messages(wf(runOf(piped, "shell: bash\n        ")))).toEqual([]);
    expect(messages(wf(runOf(piped), { jobExtra: "    defaults:\n      run:\n        shell: bash\n" }))).toEqual([]);
    expect(messages(wf(runOf(piped), { top: "defaults:\n  run:\n    shell: bash\n" }))).toEqual([]);
  });

  it("lets the step's shell win over the defaults, and the job's over the workflow's", () => {
    const defaults = { top: "defaults: { run: { shell: bash } }\n" };
    expect(messages(wf(runOf(piped, "shell: sh\n        "), defaults))).toHaveLength(1);
    expect(messages(wf(runOf(piped), { ...defaults, jobExtra: "    defaults: { run: { shell: sh } }\n" }))).toHaveLength(1);
    expect(messages(wf(runOf(piped, "shell: bash\n        "), { top: "defaults: { run: { shell: sh } }\n" }))).toEqual([]);
    expect(messages(wf(runOf(piped), { top: "defaults: { run: { shell: sh } }\n", jobExtra: "    defaults: { run: { shell: bash } }\n" }))).toEqual([]);
  });

  it("flags a shell that has no pipefail: sh, or bash with its own template", () => {
    for (const shell of ["sh", "bash -e {0}", "bash {0}", "Bash", "/bin/bash"]) {
      expect(messages(wf(runOf(piped, `shell: ${JSON.stringify(shell)}\n        `))), shell).toHaveLength(1);
    }
  });

  it("leaves a PowerShell, cmd or Python step alone: its pipe is not bash's", () => {
    for (const shell of ["pwsh", "powershell", "python", "cmd"]) {
      expect(messages(wf(runOf("Get-ChildItem | Select-Object -First 1", `shell: ${shell}\n        `))), shell).toEqual([]);
    }
  });

  it("passes a script with no pipe", () => {
    expect(messages(wf(runOf("echo hi\nnode tool.ts > out.log\nnode a.ts && node b.ts")))).toEqual([]);
    expect(messages(wf("      - uses: actions/checkout@v7\n        with: { persist-credentials: false }\n"))).toEqual([]);
  });

  it("takes || for or, not a pipe", () => {
    expect(messages(wf(runOf("node tool.ts || exit 1")))).toEqual([]);
    expect(messages(wf(runOf("[ -n \"$a\" ] || [ -n \"$b\" ] || exit 1")))).toEqual([]);
    expect(messages(wf(runOf('node tool.ts || true | cat')))).toHaveLength(1);
  });

  it("takes a | inside quotes, a comment, an escape, a heredoc body or a parameter expansion for text", () => {
    for (const script of [
      "echo 'a | b'",
      'echo "a | b"',
      "echo a \\| b",
      "# node tool.ts | tee out.log\necho hi",
      "echo hi # a | b",
      "cat <<EOF\n| a | b |\nEOF",
      "cat <<-'EOF'\n\t| a | b |\n\tEOF",
      'cat > out.md <<"END"\n| a | b |\nEND\necho done',
      'echo "${x//a|b/c}"',
      'v="${v#"${v%%[![:space:]]*}"}"',
      "grep -E 'a|b' file",
      'echo "$(echo \'a | b\')"',
    ]) {
      expect(messages(wf(runOf(script))), script).toEqual([]);
    }
  });

  it("takes arithmetic for what it is: a | is bitwise or, and a << is a shift, not a heredoc that hides what follows", () => {
    expect(messages(wf(runOf("echo $((a | b))\necho \"$(( 1 | 2 ))\"")))).toEqual([]);
    expect(messages(wf(runOf("x=$((1<<3))\nnode tool.ts | tee out.log")))).toHaveLength(1);
    expect(messages(wf(runOf("x=$(( (1<<n) | 2 ))\nnode tool.ts | tee out.log")))).toHaveLength(1);
  });

  it("goes on reading after a heredoc, a quote and a substitution", () => {
    expect(messages(wf(runOf("cat <<EOF\n| a |\nEOF\nnode tool.ts | tee out.log")))).toHaveLength(1);
    expect(messages(wf(runOf("echo 'it'\"'\"'s' | tee out.log")))).toHaveLength(1);
    expect(messages(wf(runOf('echo "$(date)" | tee out.log')))).toHaveLength(1);
  });

  it("checks a composite action's steps, where shell is required anyway", () => {
    const composite = (shell: string) => `name: x\nruns:\n  using: composite\n  steps:\n    - shell: ${shell}\n      run: ${piped}\n`;
    expect(messages(composite("sh"))).toHaveLength(1);
    expect(messages(composite("bash"))).toEqual([]);
  });

  it("takes a workflow with no steps and a job with a non-mapping defaults for nothing", () => {
    expect(messages("on: push\njobs: {}\n")).toEqual([]);
    expect(messages(wf(runOf(piped), { jobExtra: "    defaults: bash\n" }))).toHaveLength(1);
  });
});

describe("the repository's own workflows", () => {
  it("follow the hardening rules", () => {
    const root = join(dirname(import.meta.filename), "..");
    expect(lintRepository(root)).toEqual([]);
  });
});
