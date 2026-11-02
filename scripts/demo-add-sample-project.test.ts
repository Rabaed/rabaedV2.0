import { describe, expect, it } from "vitest";
import { addSampleProjectSteps } from "./demo-add-sample-project.ts";

// `pnpm demo:add-sample-project` (RP-1217): the api adds the sample Project, then its Step Age is spread.
describe("addSampleProjectSteps", () => {
  it("adds the Project through the api's script, then spreads its Step Age, in that order", () => {
    expect(addSampleProjectSteps([])).toEqual([
      ["scripts/pnpm.ts", "--filter", "@rabaed/api", "run", "demo:add-sample-project"],
      ["scripts/sample-project-age.ts"],
    ]);
  });

  it("passes its arguments (a lane, a dry run) to the Step Age step", () => {
    expect(addSampleProjectSteps(["--lane", "23"]).at(-1)).toEqual(["scripts/sample-project-age.ts", "--lane", "23"]);
  });
});
