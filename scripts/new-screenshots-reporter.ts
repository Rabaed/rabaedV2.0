import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Reporter, SerializedError, TestModule, TestRunEndReason, Vitest } from "vitest/node";

// Tells CI whether a story test run failed only because new stories have no
// screenshot baseline yet (RP-296). Run with `vitest run --update=new`, so each
// missing reference is written to test/__screenshots__ and its test still fails.
// When every failure is that, CI uploads the new PNGs and the "new screenshots"
// job in ci.yml commits them to the branch. A changed baseline, or any
// behaviour, axe or hook failure, means no: the run fails as usual and changed
// baselines still need the "update-screenshots" label.
//
// Writes { only: boolean, missing?: number } to .vitest/new-screenshots.json
// under the Vitest root (packages/ui).

// The message @vitest/browser gives toMatchScreenshot when the reference file is missing.
const missingReference = "No existing reference screenshot found";

export interface StoryRun {
  reason: TestRunEndReason;
  unhandledErrors: number;
  /** Errors in beforeAll/afterAll hooks or module loading, outside any test. */
  hookErrors: number;
  /** The error messages of each failed test. */
  failedTests: string[][];
}

export type Verdict = { only: true; missing: number } | { only: false };

export function onlyMissingReferences(run: StoryRun): Verdict {
  const only =
    run.reason === "failed" &&
    run.unhandledErrors === 0 &&
    run.hookErrors === 0 &&
    run.failedTests.length > 0 &&
    run.failedTests.every((errors) => errors.length === 1 && errors[0]?.startsWith(missingReference));
  return only ? { only, missing: run.failedTests.length } : { only };
}

export default class NewScreenshotsReporter implements Reporter {
  private root = process.cwd();

  onInit(vitest: Vitest) {
    this.root = vitest.config.root;
  }

  onTestRunEnd(testModules: ReadonlyArray<TestModule>, unhandledErrors: ReadonlyArray<SerializedError>, reason: TestRunEndReason) {
    const suites = testModules.flatMap((module) => [module, ...module.children.allSuites()]);
    const tests = testModules.flatMap((module) => [...module.children.allTests("failed")]);
    const verdict = onlyMissingReferences({
      reason,
      unhandledErrors: unhandledErrors.length,
      hookErrors: suites.reduce((count, suite) => count + suite.errors().length, 0),
      failedTests: tests.map((test) => (test.result().errors ?? []).map((error) => error.message)),
    });
    const file = resolve(this.root, ".vitest/new-screenshots.json");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(verdict));
  }
}
