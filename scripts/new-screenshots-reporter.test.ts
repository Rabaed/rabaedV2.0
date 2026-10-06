import { describe, expect, it } from "vitest";
import { onlyMissingReferences, type StoryRun } from "./new-screenshots-reporter.ts";

// The messages as Vitest reports them on CI, header line included.
const missingReference = `expect(element).toMatchScreenshot()

No existing reference screenshot found; a new one was created. Review it before running tests again.

Reference screenshot:
  /home/runner/work/rabaedV2.0/rabaedV2.0/packages/ui/test/__screenshots__/button-en-chromium-linux.png`;
const mismatch = `expect(element).toMatchScreenshot()

Screenshot does not match the stored reference.
312 pixels (ratio 0.01) differ.

Reference screenshot:
  /home/runner/work/rabaedV2.0/rabaedV2.0/packages/ui/test/__screenshots__/button-en-chromium-linux.png`;

// The same two messages exactly as @vitest/browser 5.0.2 reports them to a reporter
// (captured from a real run): matcherHint colours the header and paths with ANSI codes.
const esc = "";
const colouredHeader = `${esc}[2mexpect(${esc}[22m${esc}[31melement${esc}[39m${esc}[2m).${esc}[22mtoMatchScreenshot${esc}[2m()${esc}[22m`;
const realMissingReference = `${colouredHeader}

No existing reference screenshot found; a new one was created. Review it before running tests again.

Reference screenshot:
  ${esc}[32m/home/runner/work/rabaedV2.0/rabaedV2.0/packages/ui/test/__screenshots__/stories.test.tsx/views-activityfeedpanel-empty-en-chromium-linux.png${esc}[39m
`;
const realMismatch = `${colouredHeader}

Screenshot does not match the stored reference.
2500 pixels (ratio 1.00) differ.

Reference screenshot:
  ${esc}[32m/home/runner/work/rabaedV2.0/rabaedV2.0/packages/ui/test/__screenshots__/stories.test.tsx/button-primary-en-chromium-linux.png${esc}[39m

Actual screenshot:
  ${esc}[31m/home/runner/work/rabaedV2.0/rabaedV2.0/packages/ui/.vitest/attachments/test/stories.test.tsx/button-primary-actual-chromium-linux.png${esc}[39m
${esc}[2m
Diff image:
  /home/runner/work/rabaedV2.0/rabaedV2.0/packages/ui/.vitest/attachments/test/stories.test.tsx/button-primary-diff-chromium-linux.png${esc}[22m
`;

const run = (overrides: Partial<StoryRun>): StoryRun => ({ reason: "failed", unhandledErrors: 0, hookErrors: 0, failedTests: [], ...overrides });

describe("onlyMissingReferences", () => {
  it("counts the new baselines when every failure is a missing reference", () => {
    expect(onlyMissingReferences(run({ failedTests: [[missingReference], [missingReference], [missingReference]] }))).toEqual({ onlyMissingReferences: true, newBaselines: 3 });
  });

  it("counts the new baselines from the real, colour-coded messages", () => {
    expect(onlyMissingReferences(run({ failedTests: [[realMissingReference], [realMissingReference]] }))).toEqual({ onlyMissingReferences: true, newBaselines: 2 });
  });

  it("is not only missing references when a real, colour-coded screenshot changed", () => {
    expect(onlyMissingReferences(run({ failedTests: [[realMissingReference], [realMismatch]] }))).toEqual({ onlyMissingReferences: false });
  });

  it("counts a missing reference whose message ends with the matcher's cause", () => {
    const withCause = `${missingReference}
Caused by: Error: Matcher did not succeed in time.`;
    expect(onlyMissingReferences(run({ failedTests: [[withCause]] }))).toEqual({ onlyMissingReferences: true, newBaselines: 1 });
  });

  it("recognises a missing reference without the matcher header", () => {
    const bare = "No existing reference screenshot found; a new one was created. Review it before running tests again.";
    expect(onlyMissingReferences(run({ failedTests: [[bare]] }))).toEqual({ onlyMissingReferences: true, newBaselines: 1 });
  });

  it("is not only missing references when another error only mentions the missing-reference text", () => {
    const quoted = `expect(element).toMatchScreenshot()\n\nScreenshot does not match the stored reference.\nNote: No existing reference screenshot found for the dark theme.`;
    expect(onlyMissingReferences(run({ failedTests: [[quoted]] }))).toEqual({ onlyMissingReferences: false });
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
