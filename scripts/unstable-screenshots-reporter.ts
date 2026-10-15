import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { Reporter, SerializedError, TestModule, Vitest } from "vitest/node";

// Finds the stories that render differently twice (RP-569). The Update
// screenshots workflow renders every baseline (`vitest run --update`), then runs
// the story tests again with this reporter: each test now compares its second
// render with the first. A story whose second render does not match its first
// is unstable, so its new baseline would fail the next CI run (the builder's
// late fitView changed 13 baselines on every run, fc18c1395). The workflow puts
// those baselines back as they were, commits the rest, and fails naming them, so
// the PR's author fixes the story rather than the baseline.
//
// Writes the SecondRender, with the refusal's lines, as JSON to
// .vitest/unstable-screenshots.json under the Vitest root (packages/ui).

const mismatchLine = "Screenshot does not match the stored reference.";
const pixelsLine = /^(\d+) pixels? \(ratio [\d.]+\) differ\.$/;
const referenceLine = "Reference screenshot:";

export interface FailedTest {
  /** The test's full name, e.g. "ar > components/x.stories.tsx > Story". */
  name: string;
  errors: string[];
}

export interface SecondRun {
  unhandledErrors: number;
  /** Errors in beforeAll/afterAll hooks or module loading, outside any test. */
  hookErrors: number;
  failedTests: FailedTest[];
}

export interface Unstable {
  story: string;
  pixels: number;
  /** The baseline's absolute path, to put back as it was. */
  reference: string;
}

export interface SecondRender {
  unstable: Unstable[];
  /** Anything else that failed the second time: these stories need a look too. */
  otherFailures: string[];
}

/** A screenshot mismatch's pixels and baseline, or nothing if the error is anything else. */
function mismatchOf(message: string): { pixels: number; reference: string } | undefined {
  const lines = stripVTControlCharacters(message).split("\n").map((line) => line.trim()).filter(Boolean);
  const at = lines.indexOf(mismatchLine);
  if (at === -1) return undefined;
  const pixels = pixelsLine.exec(lines[at + 1] ?? "")?.[1];
  const referenceAt = lines.indexOf(referenceLine, at);
  const reference = referenceAt === -1 ? undefined : lines[referenceAt + 1];
  if (pixels === undefined || !reference) return undefined;
  return { pixels: Number(pixels), reference };
}

const firstLine = (message: string) => stripVTControlCharacters(message).split("\n").map((line) => line.trim()).find(Boolean) ?? "(no message)";
const count = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;

export function secondRender(run: SecondRun): SecondRender {
  const unstable: Unstable[] = [];
  const otherFailures: string[] = [];
  for (const test of run.failedTests) {
    const mismatch = test.errors.length === 1 ? mismatchOf(test.errors[0]!) : undefined;
    if (mismatch) unstable.push({ story: test.name, ...mismatch });
    else otherFailures.push(`${test.name}: ${test.errors.map(firstLine).join("; ") || "(no error)"}`);
  }
  if (run.hookErrors > 0) otherFailures.push(count(run.hookErrors, "hook error"));
  if (run.unhandledErrors > 0) otherFailures.push(count(run.unhandledErrors, "unhandled error"));
  return { unstable, otherFailures };
}

/**
 * The workflow's error lines, one per story. A story name comes from the PR's
 * code: kept to one line, with no "::" that could start a workflow command.
 */
export function refusal(unstable: Unstable[]): string[] {
  const safe = (text: string) => text.replace(/[\r\n]/g, " ").replaceAll("::", ": :");
  return unstable.map(({ story, pixels }) => `story ${safe(story)} renders differently twice (${count(pixels, "pixel")})`);
}

export default class UnstableScreenshotsReporter implements Reporter {
  private root = process.cwd();

  onInit(vitest: Vitest) {
    this.root = vitest.config.root;
  }

  onTestRunEnd(testModules: ReadonlyArray<TestModule>, unhandledErrors: ReadonlyArray<SerializedError>) {
    const suites = testModules.flatMap((module) => [module, ...module.children.allSuites()]);
    const tests = testModules.flatMap((module) => [...module.children.allTests("failed")]);
    const result = secondRender({
      unhandledErrors: unhandledErrors.length,
      hookErrors: suites.reduce((n, suite) => n + suite.errors().length, 0),
      failedTests: tests.map((test) => ({ name: test.fullName, errors: (test.result().errors ?? []).map((error) => error.message) })),
    });
    const file = resolve(this.root, ".vitest/unstable-screenshots.json");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ ...result, refusal: refusal(result.unstable) }));
  }
}
