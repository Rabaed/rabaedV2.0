import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// The setup wizard's checks (scripts/wizard-checks.sh), run in bash as the
// wizard runs them (RP-273).
const checks = fileURLToPath(new URL("../scripts/wizard-checks.sh", import.meta.url));

// Without a working bash (Windows without WSL) the wizard tests are skipped,
// with the reason in their names. CI runs on Linux, so there a missing bash
// fails the suite instead of skipping it (RP-376).
const bashAvailable = (() => {
  try {
    execFileSync("bash", ["-c", "true"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const skipReason = "bash not available: the wizard checks run in CI on Linux";
const inCi = Boolean(process.env.CI);

function wizardDescribe(name: string, body: () => void) {
  describe.skipIf(!bashAvailable)(bashAvailable ? name : `${name} (skipped, ${skipReason})`, body);
}

it.runIf(inCi)("bash is available, so the wizard tests run and are not skipped", () => {
  expect(bashAvailable, "CI must have bash: the wizard tests cannot be skipped there").toBe(true);
});

// The input goes in $INPUT: Windows drops a carriage return from arguments.
function run(command: string, input = "", env: NodeJS.ProcessEnv = process.env) {
  return execFileSync("bash", ["-c", `source "$0"; ${command}`, checks], { encoding: "utf8", env: { ...env, INPUT: input } });
}

function succeeds(command: string, input?: string, env?: NodeJS.ProcessEnv) {
  try {
    run(command, input, env);
    return true;
  } catch {
    return false;
  }
}

wizardDescribe("typed answers",() => {
  it.each([
    ["arrow keys typed before it", "\x1b[A\x1b[B\x1b[C\x1b[Drabaed-dev", "rabaed-dev"],
    ["arrow keys in application mode", "\x1bOArabaed-dev\x1bOB", "rabaed-dev"],
    ["a function key", "rab\x1b[15~aed", "rabaed"],
    ["surrounding spaces and a carriage return", "  rabaed dev \r", "rabaed dev"],
    ["tabs, a bell and a delete", "\trab\x07aed\x7f", "rabaed"],
    ["a plain answer", "+966 5x xxx xxxx", "+966 5x xxx xxxx"],
    ["Arabic", "  مؤسسة رابعد ", "مؤسسة رابعد"],
  ])("are saved clean of %s", (_, typed, saved) => {
    expect(run('clean_answer "$INPUT"', typed)).toBe(saved);
  });

  it("a saved value with hidden characters is caught, a clean one is not", () => {
    expect(succeeds('has_hidden_characters "$INPUT"', "\x1b[Arabaed-dev")).toBe(true);
    expect(succeeds('has_hidden_characters "$INPUT"', "rabaed-dev\r")).toBe(true);
    expect(succeeds('has_hidden_characters "$INPUT"', "rabaed dev")).toBe(false);
  });
});

wizardDescribe("the AWS root user",() => {
  it.each([
    ["arn:aws:iam::111111111111:root", true],
    ["arn:aws-cn:iam::111111111111:root", true],
    ["arn:aws:iam::111111111111:user/admin", false],
    ["arn:aws:sts::111111111111:assumed-role/AWSReservedSSO_AdministratorAccess_0123/admin", false],
    ["arn:aws:iam::111111111111:user/root", false],
  ])("%s is root: %s", (arn, root) => {
    expect(succeeds('is_root_arn "$INPUT"', arn)).toBe(root);
  });
});

wizardDescribe("short-lived credentials",() => {
  const bins: string[] = [];
  afterEach(() => bins.splice(0).forEach((bin) => rmSync(bin, { recursive: true, force: true })));

  // A stand-in for the AWS CLI's `configure export-credentials`.
  function awsPrinting(output: string, status = 0) {
    const bin = mkdtempSync(join(tmpdir(), "wizard-aws-"));
    bins.push(bin);
    const aws = join(bin, "aws");
    writeFileSync(aws, `#!/usr/bin/env bash\nprintf '%s' '${output}'\nexit ${status}\n`);
    chmodSync(aws, 0o755);
    return { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` };
  }

  it("are handed over when the sign-in is current", () => {
    const env = awsPrinting("export AWS_ACCESS_KEY_ID=ASIAEXAMPLE\nexport AWS_SECRET_ACCESS_KEY=example\n");
    expect(run('eval "$(export_credentials rabaed)" && printf %s "$AWS_ACCESS_KEY_ID"', "", env)).toBe("ASIAEXAMPLE");
  });

  it("are refused when the sign-in has expired", () => {
    const env = awsPrinting("Error loading SSO Token: Token has expired\n", 255);
    expect(succeeds("export_credentials rabaed", "", env)).toBe(false);
  });

  it("are refused when the CLI succeeds but exports no key", () => {
    expect(succeeds("export_credentials rabaed", "", awsPrinting(""))).toBe(false);
    expect(succeeds("export_credentials rabaed", "", awsPrinting("export AWS_ACCESS_KEY_ID=\n"))).toBe(false);
  });
});
