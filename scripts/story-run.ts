import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { SerializedError, TestModule } from "vitest/node";

// What a story test run failed on, as the screenshot reporters read it:
// new-screenshots-reporter.ts (RP-296) and unstable-screenshots-reporter.ts (RP-569).

/** A Vitest error message as its trimmed, non-empty lines, without the ANSI colour codes matcherHint puts inside it. */
export const messageLines = (message: string): string[] =>
  stripVTControlCharacters(message)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

export interface FailedTest {
  /** The test's full name, e.g. "ar > components/x.stories.tsx > Story". */
  name: string;
  errors: string[];
}

export interface RunFailures {
  unhandledErrors: number;
  /** Errors in beforeAll/afterAll hooks or module loading, outside any test. */
  hookErrors: number;
  failedTests: FailedTest[];
}

export function runFailures(testModules: ReadonlyArray<TestModule>, unhandledErrors: ReadonlyArray<SerializedError>): RunFailures {
  const suites = testModules.flatMap((module) => [module, ...module.children.allSuites()]);
  const tests = testModules.flatMap((module) => [...module.children.allTests("failed")]);
  return {
    unhandledErrors: unhandledErrors.length,
    hookErrors: suites.reduce((count, suite) => count + suite.errors().length, 0),
    failedTests: tests.map((test) => ({ name: test.fullName, errors: (test.result().errors ?? []).map((error) => error.message) })),
  };
}

/** Writes a reporter's result as JSON to .vitest/<file> under the Vitest root (packages/ui). */
export function writeResult(root: string, file: string, result: unknown) {
  const path = resolve(root, ".vitest", file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(result));
}
