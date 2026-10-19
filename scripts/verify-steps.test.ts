import { describe, expect, it } from "vitest";
import { finalLine, loadFailure, runStep, selectSteps, tail, type StepRun } from "./verify-steps.ts";

const names = (changed: string[]) => selectSteps(changed).steps.map((step) => step.name);

describe("selectSteps", () => {
  it("runs the always-on steps in order, and skips migrations and stories when neither changed", () => {
    expect(names(["scripts/verify.ts"])).toEqual(["lint", "typecheck", "test:unit", "test:seam1", "test:seam2"]);
  });

  it("includes check:migrations first when a migration changed", () => {
    expect(names(["packages/db/migrations/20261009000000_x.sql"])[0]).toBe("check:migrations");
  });

  it("includes test:stories last when packages/ui or apps/web changed", () => {
    expect(names(["packages/ui/src/board.tsx"]).at(-1)).toBe("test:stories");
    expect(names(["apps/web/src/page.tsx"]).at(-1)).toBe("test:stories");
  });

  it("does not treat a lookalike folder as UI", () => {
    expect(names(["packages/ui-kit/a.ts", "apps/webhooks/a.ts"])).not.toContain("test:stories");
  });

  it("gives every step the pnpm script of its name", () => {
    expect(selectSteps([]).steps.every((step) => step.script === step.name)).toBe(true);
  });

  it("says why a step is skipped", () => {
    const skipped = selectSteps([]).skipped;
    expect(skipped.map((s) => s.name)).toEqual(["check:migrations", "test:stories"]);
    expect(skipped.every((s) => s.reason.length > 0)).toBe(true);
  });
});

describe("tail", () => {
  it("keeps the last lines only", () => {
    expect(tail("a\nb\nc\nd\n", 2)).toBe("c\nd");
    expect(tail("a\nb", 5)).toBe("a\nb");
  });
});

describe("finalLine", () => {
  const steps = ["lint", "typecheck"];

  it("names the verified commit and the steps that passed", () => {
    expect(finalLine({ sha: "abc1234", dirty: false, steps })).toBe("pnpm verify passed on abc1234: lint, typecheck.");
  });

  it("does not print an empty commit when git could not name it", () => {
    expect(finalLine({ sha: "", dirty: false, steps })).toBe("pnpm verify passed on unknown commit: lint, typecheck.");
  });

  it("says dirty when the tree has uncommitted changes", () => {
    expect(finalLine({ sha: "abc1234", dirty: true, steps })).toBe("pnpm verify passed on abc1234 (dirty: uncommitted changes): lint, typecheck.");
  });
});

// Vitest 5's own output for each kind of failure, as captured from real runs (RP-607).
const datesTest = "apps/api/test/work-item-list-dates.test.ts";
const testTimedOut = ` FAIL  |seam1| ${datesTest} > cursor paging by Submission Date > pages with no duplicates or gaps
Error: Test timed out in 20000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ ${datesTest}:207:3
    206| describe("cursor paging by Submission Date", () => {
    207|   it("pages with no duplicates or gaps", async () => {
       |   ^
`;
const hookTimedOut = ` FAIL  |seam1| ${datesTest} [ ${datesTest} ]
Error: Hook timed out in 10000ms.
If this is a long-running hook, pass a timeout value as the last argument or configure it globally with "hookTimeout".
 ❯ ${datesTest}:17:1
`;
const workerCrashed = `⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯
Error: [vitest-pool]: Worker forks emitted error.
 ❯ EventEmitter.onTaskError node_modules/vitest/dist/chunks/index.C-uw7tH9.js:11460:21

Caused by: Error: Worker exited unexpectedly with exit code 1 during starting state
 ❯ ChildProcess.emitUnexpectedExit node_modules/vitest/dist/chunks/index.C-uw7tH9.js:10935:33
`;
const pagesTest = "apps/api/test/work-item-list-pages.test.ts";
const assertionFailed = ` FAIL  |seam1| ${pagesTest} > numbered pages > pages 10 rows at a time
AssertionError: expected [ 10, 10, 4 ] to deeply equal [ 10, 10, 5 ]

- Expected
+ Received
`;
const summary = (failed: number) => `\n Test Files  ${failed} failed | 80 passed (81)\n      Tests  ${failed} failed | 900 passed (901)\n`;

describe("loadFailure", () => {
  it("calls a failure of only timed-out tests likely machine load, names them, and gives the command to rerun only their files", () => {
    const message = loadFailure("test:seam1", `${testTimedOut}${summary(1)}`);
    expect(message).toContain("likely machine load");
    expect(message).toContain(`${datesTest} > cursor paging by Submission Date > pages with no duplicates or gaps`);
    expect(message).toContain(`pnpm test:seam1 ${datesTest}`);
    expect(message).toContain("still failed");
  });

  it("counts a timed-out hook as load too, and names each file once in the rerun command", () => {
    const message = loadFailure("test:seam1", `${testTimedOut}${hookTimedOut}${summary(1)}`);
    expect(message).toContain("likely machine load");
    expect(message).toContain(`pnpm test:seam1 ${datesTest}\n`);
  });

  it("calls workers that exit while starting load, and reruns the whole step when no test file is named", () => {
    const message = loadFailure("test:seam1", `${workerCrashed}${workerCrashed}`);
    expect(message).toContain("worker start-up: likely machine load");
    expect(message).not.toContain("Timed out:");
    expect(message).toContain("Rerun the step when the machine is quieter: pnpm test:seam1\n");
  });

  it("says nothing when any failure is a real one, even beside timeouts", () => {
    expect(loadFailure("test:seam1", `${testTimedOut}${assertionFailed}${summary(2)}`)).toBeUndefined();
    expect(loadFailure("test:seam1", `${assertionFailed}${summary(1)}`)).toBeUndefined();
  });

  it("says nothing when it finds no error it knows, or for a step that is not a seam suite", () => {
    expect(loadFailure("test:seam2", "Error: connect ECONNREFUSED 127.0.0.1:5942\n")).toBeUndefined();
    expect(loadFailure("test:seam2", "exit 1, no output\n")).toBeUndefined();
    expect(loadFailure("lint", testTimedOut)).toBeUndefined();
  });

  it("reads output printed in colour", () => {
    expect(loadFailure("test:seam2", `\x1b[31m${testTimedOut}\x1b[39m`)).toContain("pnpm test:seam2 apps/api/test/work-item-list-dates.test.ts");
  });
});

// A scripted runner: each call to `run` takes the next result and records the arguments it got.
function scripted(...results: StepRun[]) {
  const calls: string[][] = [];
  const run = (args: string[]) => {
    calls.push(args);
    return results[calls.length - 1] ?? { status: 99, output: "unexpected extra run" };
  };
  return { run, calls };
}

describe("runStep", () => {
  it("carries on when a seam step fails only on timeouts and a re-run of just those files passes, and says so in the step's label", () => {
    const { run, calls } = scripted({ status: 1, output: `${testTimedOut}${summary(1)}` }, { status: 0, output: "" });
    expect(runStep("test:seam1", run)).toEqual({ passed: true, label: "test:seam1 (re-ran 1 timed-out file)" });
    expect(calls).toEqual([["test:seam1"], ["test:seam1", datesTest]]);
  });

  it("re-runs each timed-out file, in the same step's project, and counts them in the label", () => {
    const otherTest = "apps/api/test/other.test.ts";
    const otherTimedOut = testTimedOut.replaceAll(datesTest, otherTest);
    const { run, calls } = scripted({ status: 1, output: `${testTimedOut}${otherTimedOut}` }, { status: 0, output: "" });
    expect(runStep("test:seam2", run)).toEqual({ passed: true, label: "test:seam2 (re-ran 2 timed-out files)" });
    expect(calls).toEqual([["test:seam2"], ["test:seam2", datesTest, otherTest]]);
  });

  it("stops, with the re-run's output, when the re-run fails too", () => {
    const { run, calls } = scripted({ status: 1, output: testTimedOut }, { status: 1, output: hookTimedOut });
    expect(runStep("test:seam1", run)).toEqual({ passed: false, status: 1, output: hookTimedOut, reran: true });
    expect(calls).toHaveLength(2);
  });

  it("stops at once, without a re-run, when a real failure sits next to a timeout", () => {
    const output = `${testTimedOut}${assertionFailed}${summary(2)}`;
    const { run, calls } = scripted({ status: 1, output });
    expect(runStep("test:seam1", run)).toEqual({ passed: false, status: 1, output, reran: false });
    expect(calls).toEqual([["test:seam1"]]);
  });

  it("passes a step that passed, without a re-run, and stops a step that is not a seam suite on its first failure", () => {
    const first = scripted({ status: 0, output: "" });
    expect(runStep("test:seam1", first.run)).toEqual({ passed: true, label: "test:seam1" });
    expect(first.calls).toHaveLength(1);
    const lint = scripted({ status: 1, output: testTimedOut });
    expect(runStep("lint", lint.run)).toEqual({ passed: false, status: 1, output: testTimedOut, reran: false });
    expect(lint.calls).toHaveLength(1);
  });

  it("stops without a re-run when no test file is named (workers that never started), as the whole suite is not worth running twice", () => {
    const { run, calls } = scripted({ status: 1, output: workerCrashed });
    expect(runStep("test:seam1", run)).toMatchObject({ passed: false, reran: false });
    expect(calls).toHaveLength(1);
  });
});
