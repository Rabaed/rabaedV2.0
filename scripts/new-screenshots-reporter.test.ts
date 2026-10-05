import { describe, expect, it } from "vitest";
import { onlyMissingReferences, type StoryRun } from "./new-screenshots-reporter.ts";

const missing = "No existing reference screenshot found; a new one was created. Review it before running tests again.";
const mismatch = "Screenshot does not match the stored reference. 312 pixels (ratio 0.01) differ.";

const run = (overrides: Partial<StoryRun>): StoryRun => ({ reason: "failed", unhandledErrors: 0, hookErrors: 0, failedTests: [], ...overrides });

describe("onlyMissingReferences", () => {
  it("counts the new baselines when every failure is a missing reference", () => {
    expect(onlyMissingReferences(run({ failedTests: [[missing], [missing], [missing]] }))).toEqual({ only: true, missing: 3 });
  });

  it("is not only missing references when a screenshot changed", () => {
    expect(onlyMissingReferences(run({ failedTests: [[missing], [mismatch]] }))).toEqual({ only: false });
  });

  it("is not only missing references when a behaviour or axe check failed", () => {
    expect(onlyMissingReferences(run({ failedTests: [[missing], ["expected [ 'button-name: …' ] to deeply equal []"]] }))).toEqual({ only: false });
  });

  it("is not only missing references when a screenshot was never stable", () => {
    expect(onlyMissingReferences(run({ failedTests: [["Could not capture a stable screenshot within 5000ms."]] }))).toEqual({ only: false });
  });

  it("is not only missing references when a failed test has a second error", () => {
    expect(onlyMissingReferences(run({ failedTests: [[missing, "TypeError: x is undefined"]] }))).toEqual({ only: false });
  });

  it("is not only missing references when a failed test reports no error", () => {
    expect(onlyMissingReferences(run({ failedTests: [[]] }))).toEqual({ only: false });
  });

  it("is not only missing references when a hook failed or an error was unhandled", () => {
    expect(onlyMissingReferences(run({ failedTests: [[missing]], hookErrors: 1 }))).toEqual({ only: false });
    expect(onlyMissingReferences(run({ failedTests: [[missing]], unhandledErrors: 1 }))).toEqual({ only: false });
  });

  it("is not only missing references when the run passed or was interrupted", () => {
    expect(onlyMissingReferences(run({ reason: "passed" }))).toEqual({ only: false });
    expect(onlyMissingReferences(run({ reason: "interrupted", failedTests: [[missing]] }))).toEqual({ only: false });
  });
});
