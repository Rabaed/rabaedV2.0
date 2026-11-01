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

// Log rules (RP-1199): the repository is public, so a workflow's run log leaks what a tester types.
const dispatch = (inputs: string, jobs: string, top = "") =>
  `on:\n  workflow_dispatch:\n    inputs:\n${inputs}\n${top}permissions: { contents: read }\njobs:\n${jobs}`;
const stringInput = "      who:\n        type: string\n";
const bareInput = "      who:\n        description: no type, so a string\n";
const choiceInput = "      mode:\n        type: choice\n        options: [a, b]\n";
const boolInput = "      dry:\n        type: boolean\n";

describe("string workflow_dispatch inputs stay out of env", () => {
  // These fixtures read the input with no refusal step; that is the next rule's business.
  const envFindings = (source: string) => messages(source).filter((m) => !m.includes("first step"));
  const job = (env: string, level: "job" | "step" = "step") =>
    level === "job"
      ? `  a:\n    runs-on: ubuntu-latest\n    env:\n      V: ${env}\n    steps:\n      - run: echo hi\n`
      : `  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n        env:\n          V: ${env}\n`;

  it("flags a string input read through inputs.x or github.event.inputs.x in a step's env", () => {
    for (const expr of ["${{ inputs.who }}", "${{ github.event.inputs.who }}", "${{ inputs['who'] }}", "${{ inputs.who || 'x' }}"]) {
      const found = envFindings(dispatch(stringInput, job(`"${expr}"`)));
      expect(found, expr).toHaveLength(1);
      expect(found[0]).toContain("who");
      expect(found[0]).toContain("event file");
    }
  });

  it("treats an input with no type as a string, and checks job-level and workflow-level env", () => {
    expect(envFindings(dispatch(bareInput, job('"${{ inputs.who }}"')))).toHaveLength(1);
    expect(envFindings(dispatch(stringInput, job('"${{ inputs.who }}"', "job")))).toHaveLength(1);
    expect(envFindings(dispatch(stringInput, job("x"), 'env:\n  V: "${{ inputs.who }}"\n'))).toHaveLength(1);
  });

  it("flags a string input in a run script once, as a string input of rule 5 or this rule", () => {
    const found = envFindings(dispatch(stringInput, '  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "${{ inputs.who }}"\n'));
    expect(found).toHaveLength(1);
    const guarded = envFindings(dispatch(stringInput, "  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: test \"${{ inputs.who == 'x' && 1 || 0 }}\" = 1\n"));
    expect(guarded).toHaveLength(1);
    expect(guarded[0]).toContain("who");
  });

  it("accepts choice, boolean and number inputs in env, and a string input in a job if:", () => {
    const env = '"${{ inputs.mode }}"';
    expect(envFindings(dispatch(choiceInput + boolInput, job(env)))).toEqual([]);
    expect(envFindings(dispatch(choiceInput + boolInput, job('"${{ inputs.dry }}"')))).toEqual([]);
    expect(envFindings(dispatch("      n:\n        type: number\n", job('"${{ inputs.n }}"')))).toEqual([]);
    const ifOnly = `  a:\n    if: inputs.who == 'x'\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`;
    expect(envFindings(dispatch(stringInput, ifOnly))).toEqual([]);
  });

  it("leaves a composite action's own inputs alone", () => {
    const source = "name: x\ninputs:\n  who:\n    default: ''\nruns:\n  using: composite\n  steps:\n    - shell: bash\n      run: echo hi\n      env:\n        W: ${{ inputs.who }}\n";
    expect(messages(source)).toEqual([]);
  });
});

describe("a tee to the step summary under environment uat goes through masked", () => {
  const uat = (run: string, environment = "environment: uat\n    ") =>
    `on: push\npermissions: { contents: read }\njobs:\n  a:\n    ${environment}runs-on: ubuntu-latest\n    steps:\n      - run: |\n${run
      .split("\n")
      .map((line) => `          ${line}`)
      .join("\n")}\n`;

  it("passes a pipe that goes through masked before the tee", () => {
    expect(messages(uat('node tool.ts 2>&1 | masked | tee -a "$GITHUB_STEP_SUMMARY"'))).toEqual([]);
    expect(messages(uat("node tool.ts | masked | tee -a $GITHUB_STEP_SUMMARY"))).toEqual([]);
    expect(messages(uat('node tool.ts 2>&1 \\\n  | masked \\\n  | tee -a "${GITHUB_STEP_SUMMARY}"'))).toEqual([]);
  });

  it("flags a tee to the summary with no masked stage right before it", () => {
    for (const run of [
      'node tool.ts | tee -a "$GITHUB_STEP_SUMMARY"',
      "node tool.ts | tee $GITHUB_STEP_SUMMARY",
      'masked | node tool.ts | tee -a "$GITHUB_STEP_SUMMARY"',
      'node tool.ts | sed s/a/b/ | tee -a "$GITHUB_STEP_SUMMARY"',
      'node tool.ts 2>&1 \\\n  | tee -a "$GITHUB_STEP_SUMMARY"',
    ]) {
      const found = messages(uat(run));
      expect(found, run).toHaveLength(1);
      expect(found[0]).toContain("masked");
      expect(found[0]).toContain("GITHUB_STEP_SUMMARY");
    }
  });

  it("does not flag plain echo of fixed text, a tee to another file, or a job outside environment uat", () => {
    expect(messages(uat('echo "### Deployed" >> "$GITHUB_STEP_SUMMARY"'))).toEqual([]);
    expect(messages(uat("node tool.ts | tee out.log"))).toEqual([]);
    expect(messages(uat('node tool.ts | tee -a "$GITHUB_STEP_SUMMARY"', ""))).toEqual([]);
    expect(messages(uat('node tool.ts | tee -a "$GITHUB_STEP_SUMMARY"', "environment: { name: other }\n    "))).toEqual([]);
  });

  it("recognises environment uat given as a mapping", () => {
    expect(messages(uat('node tool.ts | tee -a "$GITHUB_STEP_SUMMARY"', "environment: { name: uat }\n    "))).toHaveLength(1);
  });
});

describe("::add-mask:: is never given a value shorter than 8 characters", () => {
  const mask = (script: string) =>
    messages(
      `on: push\npermissions: { contents: read }\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n${script
        .split("\n")
        .map((line) => `          ${line}`)
        .join("\n")}\n`,
    );

  it("passes a literal of 8 or more characters, and a variable guarded by a length test", () => {
    expect(mask("echo ::add-mask::12345678")).toEqual([]);
    expect(mask('v="$(get)"\nif [ "${#v}" -ge 8 ]; then echo "::add-mask::$v"; fi')).toEqual([]);
    expect(mask('v="$(get)"\nif [[ ${#v} -ge 8 ]]; then echo "::add-mask::${v}"; fi')).toEqual([]);
    expect(mask('v="$(get)"\nif [ ${#v} -gt 7 ]; then echo "::add-mask::$v"; fi')).toEqual([]);
    expect(mask('v="$(get)"\nif (( ${#v} >= 12 )); then echo "::add-mask::$v"; fi')).toEqual([]);
  });

  it("flags a literal shorter than 8 characters", () => {
    for (const script of ["echo ::add-mask::auto", 'echo "::add-mask::2"', "echo '::add-mask::1234567'"]) {
      const found = mask(script);
      expect(found, script).toHaveLength(1);
      expect(found[0]).toContain("8");
    }
  });

  it("flags a variable that is only tested for being non-empty, or tested for a number below 8", () => {
    for (const script of [
      'v="$(get)"\nif [ -n "$v" ]; then echo "::add-mask::$v"; fi',
      'v="$(get)"\nif [ "${#v}" -ge 4 ]; then echo "::add-mask::$v"; fi',
      'v="$(get)"\nif [ "${#v}" -gt 3 ]; then echo "::add-mask::$v"; fi',
      'echo "::add-mask::${v}"',
      'other=x\nif [ "${#other}" -ge 8 ]; then echo "::add-mask::$v"; fi',
    ]) {
      const found = mask(script);
      expect(found, script).toHaveLength(1);
      expect(found[0]).toContain("length");
    }
  });

  it("flags a command substitution, which has no variable to test; assign it first", () => {
    const found = mask('echo "::add-mask::$(node tool.ts bypass)"');
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("variable");
  });

  it("says so once for a value masked twice, and checks every step", () => {
    expect(mask('echo "::add-mask::$v"\necho "::add-mask::$v"')).toHaveLength(1);
    expect(mask('echo "::add-mask::$a"\necho "::add-mask::$b"')).toHaveLength(2);
  });
});

describe("a workflow with string inputs refuses a carriage return or newline in its first step", () => {
  // The accepted shape is age-uat.yml's first step.
  const refuse = [
    "      - name: Check the inputs",
    "        run: |",
    '          for key in who; do',
    `            if jq -e --arg k "$key" '(.inputs[$k] // "") | test("[\\r\\n]")' "$GITHUB_EVENT_PATH" > /dev/null; then`,
    '              echo "::error::$key takes one line only"',
    "              exit 1",
    "            fi",
    "          done",
  ].join("\n");
  const reader = '      - run: jq -r \'.inputs.who // ""\' "$GITHUB_EVENT_PATH"\n';
  const checkout = "      - uses: actions/checkout@v7\n        with: { persist-credentials: false }\n";
  const job = (steps: string, extra = "") => `  a:\n    runs-on: ubuntu-latest\n${extra}    steps:\n${steps}`;
  const found = (steps: string, inputs = stringInput) => messages(dispatch(inputs, job(steps)));

  it("passes when the job's first step tests every string input and exits", () => {
    expect(found(refuse + "\n" + checkout + reader)).toEqual([]);
  });

  it("flags a reading job whose first step is not a refusal", () => {
    const missing = found(checkout + reader);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain("job a");
    expect(missing[0]).toContain("first step");
    expect(found('      - run: echo hi\n' + reader)).toHaveLength(1);
    // the refusal is there, but not first
    expect(found(checkout + refuse + "\n" + reader)).toHaveLength(1);
  });

  it("flags a first step that tests for a newline and carriage return but skips a string input", () => {
    const two = stringInput + "      other:\n        type: string\n";
    const skipsOther = found(refuse + "\n" + reader + '      - run: jq -r \'.inputs.other\' "$GITHUB_EVENT_PATH"\n', two);
    expect(skipsOther).toHaveLength(1);
    expect(skipsOther[0]).toContain("other");
  });

  it("flags a first step that only tests one of the two characters, or never exits", () => {
    expect(found(refuse.replace("\\r", "") + "\n" + reader)).toHaveLength(1);
    expect(found(refuse.replace("exit 1", "echo no") + "\n" + reader)).toHaveLength(1);
  });

  it("does not ask for it of a job that never reads the inputs, nor of an input only compared in an if:", () => {
    const confirm = "      confirm:\n        type: string\n";
    const jobs = `  stop:\n    if: inputs.confirm != 'go'\n    runs-on: ubuntu-latest\n    steps:\n      - run: exit 1\n  go:\n    if: inputs.confirm == 'go'\n    runs-on: ubuntu-latest\n    steps:\n${checkout}`;
    expect(messages(dispatch(confirm, jobs))).toEqual([]);
    // a second job that reads: only that one is held to it
    const both = jobs + job(refuse + "\n" + reader).replace("  a:", "  c:");
    expect(messages(dispatch(confirm + stringInput, both))).toEqual([]);
  });

  it("ignores choice and boolean inputs read from the event file", () => {
    expect(found('      - run: jq -r \'.inputs.mode\' "$GITHUB_EVENT_PATH"\n', choiceInput + boolInput)).toEqual([]);
  });
});

describe("the repository's own workflows", () => {
  it("follow the hardening rules", () => {
    const root = join(dirname(import.meta.filename), "..");
    expect(lintRepository(root)).toEqual([]);
  });
});
