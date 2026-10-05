import { describe, expect, it } from "vitest";
import { onlyMissingReferences, type StoryRun } from "./new-screenshots-reporter.ts";

const missingReference = "No existing reference screenshot found; a new one was created. Review it before running tests again.";
const mismatch = "Screenshot does not match the stored reference. 312 pixels (ratio 0.01) differ.";

const run = (overrides: Partial<StoryRun>): StoryRun => ({ reason: "failed", unhandledErrors: 0, hookErrors: 0, failedTests: [], ...overrides });

describe("onlyMissingReferences", () => {
  it("counts the new baselines when every failure is a missing reference", () => {
    expect(onlyMissingReferences(run({ failedTests: [[missingReference], [missingReference], [missingReference]] }))).toEqual({ onlyMissingReferences: true, newBaselines: 3 });
  });

  it("is not only missing references when a screenshot changed", () => {
    expect(onlyMissingReferences(run({ failedTests: [[missingReference], [mismatch]] }))).toEqual({ onlyMissingReferences: false });
  });

  it("is not only missing references when a behaviour or axe check failed", () => {
    expect(onlyMissingReferences(run({ failedTests: [[missingReference], ["expected [ 'button-name: …' ] to deeply equal []"]] }))).toEqual({ onlyMissingReferences: false });
  });

  it("is not only missing references when a screenshot was never stable", () => {
    expect(onlyMissingReferences(run({ failedTests: [["Could not capture a stable screenshot within 5000ms."]] }))).toEqual({ onlyMissingReferences: false });
  });

  it("is not only missing references when a failed test has a second error", () => {
    expect(onlyMissingReferences(run({ failedTests: [[missingReference, "TypeError: x is undefined"]] }))).toEqual({ onlyMissingReferences: false });
  });

  it("is not only missing references when a failed test reports no error", () => {
    expect(onlyMissingReferences(run({ failedTests: [[]] }))).toEqual({ onlyMissingReferences: false });
  });

  it("is not only missing references when a hook failed or an error was unhandled", () => {
    expect(onlyMissingReferences(run({ failedTests: [[missingReference]], hookErrors: 1 }))).toEqual({ onlyMissingReferences: false });
    expect(onlyMissingReferences(run({ failedTests: [[missingReference]], unhandledErrors: 1 }))).toEqual({ onlyMissingReferences: false });
  });

  it("is not only missing references when the run passed or was interrupted", () => {
    expect(onlyMissingReferences(run({ reason: "passed" }))).toEqual({ onlyMissingReferences: false });
    expect(onlyMissingReferences(run({ reason: "interrupted", failedTests: [[missingReference]] }))).toEqual({ onlyMissingReferences: false });
  });
});
