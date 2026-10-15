import type { Reporter, SerializedError, TestModule, TestRunEndReason, Vitest } from "vitest/node";
import { messageLines, type RunFailures, runFailures, writeResult } from "./story-run.ts";

// Tells CI whether a story test run failed only because new stories have no
// screenshot baseline yet (RP-296). Run with `vitest run --update=new`, so each
// missing reference is written to test/__screenshots__ and its test still fails.
// When every failure is that, CI uploads the new PNGs and
// update-screenshots.yml commits them to the PR branch. A changed
// baseline, or any behaviour, axe or hook failure, means no: the run fails as
// usual and changed baselines still need the "update-screenshots" label.
//
// Writes the Verdict as JSON to .vitest/new-screenshots.json under the Vitest
// root (packages/ui).

// The message @vitest/browser gives toMatchScreenshot when the reference file is missing.
// It comes after an "expect(element).toMatchScreenshot()" header line, which
// matcherHint colours with ANSI codes inside the message itself (RP-379).
const missingReference = "No existing reference screenshot found";
const matcherHeader = /^expect\(.*\)\.toMatchScreenshot\(\)$/;

function isMissingReference(message: string): boolean {
  const lines = messageLines(message);
  const body = matcherHeader.test(lines[0] ?? "") ? lines[1] : lines[0];
  return body?.startsWith(missingReference) ?? false;
}

export interface StoryRun extends Omit<RunFailures, "failedTests"> {
  reason: TestRunEndReason;
  /** The error messages of each failed test. */
  failedTests: string[][];
}

export type Verdict = { onlyMissingReferences: true; newBaselines: number } | { onlyMissingReferences: false };

export function onlyMissingReferences(run: StoryRun): Verdict {
  const only =
    run.reason === "failed" &&
    run.unhandledErrors === 0 &&
    run.hookErrors === 0 &&
    run.failedTests.length > 0 &&
    run.failedTests.every((errors) => errors.length === 1 && isMissingReference(errors[0] ?? ""));
  return only ? { onlyMissingReferences: true, newBaselines: run.failedTests.length } : { onlyMissingReferences: false };
}

export default class NewScreenshotsReporter implements Reporter {
  private root = process.cwd();

  onInit(vitest: Vitest) {
    this.root = vitest.config.root;
  }

  onTestRunEnd(testModules: ReadonlyArray<TestModule>, unhandledErrors: ReadonlyArray<SerializedError>, reason: TestRunEndReason) {
    const run = runFailures(testModules, unhandledErrors);
    const verdict = onlyMissingReferences({ ...run, reason, failedTests: run.failedTests.map((test) => test.errors) });
    writeResult(this.root, "new-screenshots.json", verdict);
  }
}
