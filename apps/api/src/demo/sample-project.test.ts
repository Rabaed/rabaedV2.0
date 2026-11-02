import { describe, expect, it } from "vitest";
import { publicFailure } from "./sample-project.ts";

// UAT's job log is public (RP-1217 review): a refused api call prints its method, path and status, never its body.
describe("publicFailure", () => {
  it("drops a refused call's answer, which can quote a Subject or an answer", () => {
    const error = new Error('Demo seed: POST /v1/projects/1b9d/work-items answered 422 {"fields":[{"key":"title"}],"title":"Fan coil units – Tower A Level 03"}');
    expect(publicFailure(error)).toBe("Demo seed: POST /v1/projects/1b9d/work-items answered 422");
  });

  it("keeps a message of the seed's own as it is", () => {
    expect(publicFailure(new Error("Sample project: a Code B raised no Comment"))).toBe("Sample project: a Code B raised no Comment");
  });
});
