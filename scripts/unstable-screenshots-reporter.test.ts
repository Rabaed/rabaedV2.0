import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { RunFailures } from "./story-run.ts";
import { refusal, stabilityOf } from "./unstable-screenshots-reporter.ts";

// Messages exactly as @vitest/browser 5.0.2 reports them to a reporter (captured
// from real runs): matcherHint colours the header and paths with ANSI codes.
const esc = "\u001b";
const header = `${esc}[2mexpect(${esc}[22m${esc}[31melement${esc}[39m${esc}[2m).${esc}[22mtoMatchScreenshot${esc}[2m()${esc}[22m`;
const reference = "/home/runner/work/rabaedV2.0/rabaedV2.0/packages/ui/test/__screenshots__/stories.test.tsx/workflow-workflowbuilder-end-selected-en-chromium-linux.png";
const mismatch = (pixels: number, ratio = "0.01") => `${header}

Screenshot does not match the stored reference.
${pixels} pixels (ratio ${ratio}) differ.

Reference screenshot:
  ${esc}[32m${reference}${esc}[39m

Actual screenshot:
  ${esc}[31m/home/runner/work/rabaedV2.0/rabaedV2.0/packages/ui/.vitest/attachments/test/stories.test.tsx/workflow-workflowbuilder-end-selected-en-actual-chromium-linux.png${esc}[39m
${esc}[2m
Diff image:
  /home/runner/work/rabaedV2.0/rabaedV2.0/packages/ui/.vitest/attachments/test/stories.test.tsx/workflow-workflowbuilder-end-selected-en-diff-chromium-linux.png${esc}[22m
`;
const story = "en > components/workflow/workflow-builder.stories.tsx > EndSelected";

const run = (overrides: Partial<RunFailures>): RunFailures => ({ unhandledErrors: 0, hookErrors: 0, failedTests: [], ...overrides });

describe("stabilityOf", () => {
  it("finds nothing unstable when the second render matched the first everywhere", () => {
    expect(stabilityOf(run({}))).toEqual({ unstable: [], otherFailures: [] });
  });

  it("names a story whose second render differs from the first, with its pixels and baseline", () => {
    expect(stabilityOf(run({ failedTests: [{ name: story, errors: [mismatch(48)] }] }))).toEqual({
      unstable: [{ story, pixels: 48, reference }],
      otherFailures: [],
    });
  });

  it("names every unstable story", () => {
    const other = "ar > components/workflow/workflow-builder.stories.tsx > StepAfterSendBack";
    const { unstable } = stabilityOf(run({ failedTests: [{ name: story, errors: [mismatch(48)] }, { name: other, errors: [mismatch(1171, "0.00")] }] }));
    expect(unstable.map((u) => [u.story, u.pixels])).toEqual([
      [story, 48],
      [other, 1171],
    ]);
  });

  it("reads a mismatch without colour codes or the matcher header", () => {
    const bare = `Screenshot does not match the stored reference.\n206 pixels (ratio 0.00) differ.\n\nReference screenshot:\n  ${reference}`;
    expect(stabilityOf(run({ failedTests: [{ name: story, errors: [bare] }] })).unstable).toEqual([{ story, pixels: 206, reference }]);
  });

  it("keeps any other failure apart: a play function, axe or an unstable screenshot capture", () => {
    const failures = [
      { name: story, errors: ["expected [ 'button-name: …' ] to deeply equal []"] },
      { name: "ar > x.stories.tsx > Y", errors: ["Could not capture a stable screenshot within 5000ms."] },
    ];
    expect(stabilityOf(run({ failedTests: failures }))).toEqual({
      unstable: [],
      otherFailures: [`${story}: expected [ 'button-name: …' ] to deeply equal []`, "ar > x.stories.tsx > Y: Could not capture a stable screenshot within 5000ms."],
    });
  });

  it("counts a mismatch with a second error as another failure", () => {
    const { unstable, otherFailures } = stabilityOf(run({ failedTests: [{ name: story, errors: [mismatch(48), "TypeError: x is undefined"] }] }));
    expect(unstable).toEqual([]);
    expect(otherFailures).toHaveLength(1);
  });

  it("counts hook and unhandled errors as other failures", () => {
    expect(stabilityOf(run({ hookErrors: 2, unhandledErrors: 1 })).otherFailures).toEqual(["2 hook errors", "1 unhandled error"]);
  });
});

describe("refusal", () => {
  it("says which stories render differently twice, one line each", () => {
    expect(
      refusal([
        { story, pixels: 48, reference },
        { story: "ar > a.stories.tsx > B", pixels: 1, reference },
      ]),
    ).toEqual([`story ${story} renders differently twice (48 pixels)`, "story ar > a.stories.tsx > B renders differently twice (1 pixel)"]);
  });

  it("keeps a story name to one line", () => {
    const [line] = refusal([{ story: "x\r\ny", pixels: 3, reference }]);
    expect(line).toBe("story x y renders differently twice (3 pixels)");
  });
});

// The Update screenshots workflow's wiring of the second render (RP-569).
describe("update-screenshots.yml", () => {
  type Step = { id?: string; uses?: string; run?: string; env?: Record<string, string> };
  type Job = { if?: string; needs?: string[]; permissions?: Record<string, string>; outputs?: Record<string, string>; steps: Step[] };
  const file = join(dirname(import.meta.filename), "..", ".github", "workflows", "update-screenshots.yml");
  const { jobs } = parse(readFileSync(file, "utf8")) as { jobs: Record<string, Job> };
  const render = jobs.render!;
  const unstable = jobs.unstable!;
  const at = (predicate: (step: Step) => boolean) => render.steps.findIndex(predicate);

  it("renders every story a second time with this reporter, after the first render and before the upload", () => {
    const first = at((s) => s.run?.includes("vitest run --update") ?? false);
    const second = at((s) => s.id === "second");
    const upload = at((s) => s.uses?.startsWith("actions/upload-artifact") ?? false);
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(upload).toBeGreaterThan(second);
    expect(render.steps[second]?.env?.REPORTER).toBe("scripts/unstable-screenshots-reporter.ts");
    expect(render.steps[second]?.run).toContain("git checkout --quiet HEAD --");
    // Fails closed: a jq error in a pipe stops the step, and an unreadable result commits nothing.
    expect(render.steps[second]?.run).toContain("set -o pipefail");
    expect(render.steps[second]?.run).toMatch(/if ! jq -e /);
    expect(render.outputs?.refusal).toContain("steps.second.outputs.refusal");
  });

  it("refuses after the commit, in a job without permissions, only when a story was unstable", () => {
    expect(unstable.needs).toEqual(["render", "commit"]);
    expect(unstable.permissions).toEqual({});
    expect(unstable.if).toContain("!cancelled()");
    expect(unstable.if).toContain("needs.render.outputs.refusal != '[]'");
    expect(unstable.steps.at(-1)?.run).toMatch(/exit 1\s*$/);
  });

  it("still commits the stable baselines when a story was unstable", () => {
    expect(jobs.commit!.if).toContain("needs.render.result == 'success'");
  });
});
