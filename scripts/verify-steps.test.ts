import { describe, expect, it } from "vitest";
import { failureEnd, finalLine, isSeamStep, loadFailure, runStep, selectSteps, startFrom, tail, type StepRun } from "./verify-steps.ts";

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

describe("startFrom", () => {
  const codeOnly = selectSteps(["scripts/verify.ts"]);

  it("starts at the named step and lists the steps before it as not run", () => {
    expect(startFrom(codeOnly, "test:seam1")).toEqual({
      steps: [{ name: "test:seam1", script: "test:seam1" }, { name: "test:seam2", script: "test:seam2" }],
      from: { step: "test:seam1", notRun: ["lint", "typecheck", "test:unit"] },
    });
  });

  it("is a complete run, with no --from on its last line, from the first step this diff runs", () => {
    expect(startFrom(codeOnly, "lint")).toEqual({ steps: codeOnly.steps });
    const done = startFrom(codeOnly, "lint");
    expect(finalLine({ sha: "abc1234", dirty: false, steps: ["lint"], ...("from" in done ? { from: done.from } : {}) })).toBe("pnpm verify passed on abc1234: lint.");
  });

  it("refuses a step this diff does not run, with the reason it is skipped and the steps it does run", () => {
    expect(startFrom(codeOnly, "test:stories")).toEqual({
      error: "pnpm verify does not run test:stories for this branch (nothing changed in packages/ui or apps/web), so it cannot start there. It runs: lint, typecheck, test:unit, test:seam1, test:seam2.",
    });
  });
});

describe("tail", () => {
  it("keeps the last lines only", () => {
    expect(tail("a\nb\nc\nd\n", 2)).toBe("c\nd");
    expect(tail("a\nb", 5)).toBe("a\nb");
  });
});

describe("isSeamStep", () => {
  it("names the seam suites, and no other step", () => {
    expect(["test:seam1", "test:seam2"].every(isSeamStep)).toBe(true);
    expect(["lint", "typecheck", "test:unit", "test:stories", "check:migrations"].some(isSeamStep)).toBe(false);
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

  it("after --from, names where it started and the steps it did not run, so a partial run never reads as a full pass", () => {
    expect(finalLine({ sha: "abc1234", dirty: false, steps: ["test:seam1", "test:seam2"], from: { step: "test:seam1", notRun: ["lint", "typecheck", "test:unit"] } })).toBe(
      "pnpm verify --from test:seam1 passed on abc1234: test:seam1, test:seam2. Not run: lint, typecheck, test:unit, so this is not a complete run.",
    );
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

// What a seam run prints when Docker stops under it (RP-994): node-postgres's error for the
// terminated connection (lower-case "error:", its code on a later line), among failed tests.
const terminated = `⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯
Vitest caught 1 unhandled error during the test run.
error: terminating connection due to administrator command
 ❯ Parser.parseErrorMessage node_modules/pg-protocol/dist/parser.js:285:98
{
  length: 116,
  severity: 'FATAL',
  code: '57P01',
  routine: 'ProcessInterrupts'
}
`;
const codeOnly = `Error: Connection terminated unexpectedly\n  code: '57P01',\n`;
// What packages/db/test/pool-error.test.ts prints when it fails for real: it terminates a backend on
// purpose, so its assertion diff and code frame name 57P01 and the server's text, yet Postgres is fine.
const poolErrorFailed = ` FAIL  |seam2| packages/db/test/pool-error.test.ts > pool error > logs an idle connection's error and keeps serving
AssertionError: expected { level: 'warn', …(2) } to deeply equal { level: 'warn', …(2) }

- Expected
+ Received

  {
    "err": {
-     "code": "57P01",
+     "code": "XX000",
      "type": "DatabaseError",
    },
    "level": "warn",
    "msg": "idle database connection failed",
  }

 ❯ packages/db/test/pool-error.test.ts:63:31
     61|
     62|     expect(unhandled).toEqual([]);
     63|     expect(JSON.parse(line!)).toEqual({ level: "warn", msg: "idle database connection failed", err: { type: "DatabaseError", code: "57P01" } });
       |                               ^
     64|     // The server's own text ("terminating connection due to administrator command") is not logged.
     65|     expect(line).not.toContain("terminating");
${summary(1)}`;

describe("failureEnd", () => {
  const terminationLine = /^pnpm verify stopped at test:seam1: Postgres was terminated \(.+\), Docker may have stopped\. Restart it \(.+\) and run pnpm verify again\.$/;

  it("ends with one line saying Postgres was terminated when a seam step's output holds 57P01", () => {
    const lines = failureEnd("test:seam1", `${assertionFailed}${terminated}${summary(38)}`, true);
    expect(lines).toEqual([expect.stringMatching(terminationLine)]);
    expect(lines[0]).toContain("Postgres was terminated (57P01)");
  });

  it("says the same when the step's Postgres no longer answers, though its output holds no 57P01", () => {
    const lines = failureEnd("test:seam1", `Error: connect ECONNREFUSED 127.0.0.1:5842\n${summary(38)}`, false);
    expect(lines).toEqual([expect.stringMatching(terminationLine)]);
    expect(lines[0]).toContain("it no longer answers");
  });

  it("finds 57P01 on its own line and in colour", () => {
    expect(failureEnd("test:seam1", codeOnly, true)).toEqual([expect.stringMatching(terminationLine)]);
    expect(failureEnd("test:seam1", "FATAL:  terminating connection due to administrator command\n", true)).toEqual([expect.stringMatching(terminationLine)]);
    expect(failureEnd("test:seam1", `\x1b[31m${terminated}\x1b[39m`, true)).toEqual([expect.stringMatching(terminationLine)]);
  });

  it("does not read a failing test's assertion diff or code frame that names 57P01 as a terminated Postgres", () => {
    expect(failureEnd("test:seam2", poolErrorFailed, true)).toEqual(["pnpm verify stopped at test:seam2."]);
  });

  it("gives the load note, then the plain stop line, for timeouts while Postgres answers", () => {
    const output = `${testTimedOut}${summary(1)}`;
    expect(failureEnd("test:seam1", output, true)).toEqual([loadFailure("test:seam1", output), "pnpm verify stopped at test:seam1."]);
  });

  it("does not blame machine load for timeouts when Postgres was terminated or no longer answers", () => {
    for (const [output, answers] of [[`${testTimedOut}${terminated}`, true], [testTimedOut, false]] as const) {
      expect(failureEnd("test:seam1", output, answers)).toEqual([expect.stringMatching(terminationLine)]);
    }
    expect(loadFailure("test:seam1", `${testTimedOut}${terminated}`)).toBeUndefined();
  });

  it("names --from in the stop line of a resumed run, so it never reads as a whole run", () => {
    expect(failureEnd("lint", "", true, "pnpm verify --from lint")).toEqual(["pnpm verify --from lint stopped at lint."]);
    expect(failureEnd("test:seam1", `${testTimedOut}${terminated}`, true, "pnpm verify --from seam1")[0]).toMatch(/^pnpm verify --from seam1 stopped at test:seam1: Postgres was terminated/);
  });

  it("gives only the plain stop line for a real failure while Postgres answers, or for a step that is not a seam suite", () => {
    expect(failureEnd("test:seam1", `${assertionFailed}${summary(1)}`, true)).toEqual(["pnpm verify stopped at test:seam1."]);
    expect(failureEnd("lint", terminated, false)).toEqual(["pnpm verify stopped at lint."]);
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
  it("carries on when a seam step fails only on timeouts and a re-run of just those files passes, and says so in the step's label", async () => {
    const { run, calls } = scripted({ status: 1, output: `${testTimedOut}${summary(1)}` }, { status: 0, output: "" });
    expect(await runStep("test:seam1", run)).toEqual({ passed: true, label: "test:seam1 (re-ran 1 timed-out file)" });
    expect(calls).toEqual([["test:seam1"], ["test:seam1", datesTest]]);
  });

  it("re-runs each timed-out file, in the same step's project, and counts them in the label", async () => {
    const otherTest = "apps/api/test/other.test.ts";
    const otherTimedOut = testTimedOut.replaceAll(datesTest, otherTest);
    const { run, calls } = scripted({ status: 1, output: `${testTimedOut}${otherTimedOut}` }, { status: 0, output: "" });
    expect(await runStep("test:seam2", run)).toEqual({ passed: true, label: "test:seam2 (re-ran 2 timed-out files)" });
    expect(calls).toEqual([["test:seam2"], ["test:seam2", datesTest, otherTest]]);
  });

  it("stops, with the re-run's output, when the re-run fails too", async () => {
    const { run, calls } = scripted({ status: 1, output: testTimedOut }, { status: 1, output: hookTimedOut });
    expect(await runStep("test:seam1", run)).toEqual({ passed: false, status: 1, output: hookTimedOut, reran: true });
    expect(calls).toHaveLength(2);
  });

  it("stops at once, without a re-run, when a real failure sits next to a timeout", async () => {
    const output = `${testTimedOut}${assertionFailed}${summary(2)}`;
    const { run, calls } = scripted({ status: 1, output });
    expect(await runStep("test:seam1", run)).toEqual({ passed: false, status: 1, output, reran: false });
    expect(calls).toEqual([["test:seam1"]]);
  });

  it("passes a step that passed, without a re-run, and stops a step that is not a seam suite on its first failure", async () => {
    const first = scripted({ status: 0, output: "" });
    expect(await runStep("test:seam1", first.run)).toEqual({ passed: true, label: "test:seam1" });
    expect(first.calls).toHaveLength(1);
    const lint = scripted({ status: 1, output: testTimedOut });
    expect(await runStep("lint", lint.run)).toEqual({ passed: false, status: 1, output: testTimedOut, reran: false });
    expect(lint.calls).toHaveLength(1);
  });

  it("stops without a re-run, keeping the output that names it, when Postgres was terminated beside the timeouts", async () => {
    const output = `${testTimedOut}${terminated}`;
    const { run, calls } = scripted({ status: 1, output });
    expect(await runStep("test:seam1", run)).toEqual({ passed: false, status: 1, output, reran: false });
    expect(calls).toHaveLength(1);
  });

  it("stops without a re-run when the timeouts came with a Postgres that no longer answers", async () => {
    const { run, calls } = scripted({ status: 1, output: testTimedOut });
    expect(await runStep("test:seam1", run, async () => false)).toEqual({ passed: false, status: 1, output: testTimedOut, reran: false });
    expect(calls).toHaveLength(1);
  });

  it("stops without a re-run when no test file is named (workers that never started), as the whole suite is not worth running twice", async () => {
    const { run, calls } = scripted({ status: 1, output: workerCrashed });
    expect(await runStep("test:seam1", run)).toMatchObject({ passed: false, reran: false });
    expect(calls).toHaveLength(1);
  });
});
