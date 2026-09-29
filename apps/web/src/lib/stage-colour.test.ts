import { describe, expect, it } from "vitest";
import { stageColour } from "./stage-colour.ts";

describe("stageColour", () => {
  it("gives each Rabaed Default MAR Stage its own design system colour", () => {
    expect(stageColour({ key: "draft", category: "draft" })).toBe("draft");
    expect(stageColour({ key: "internal_review", category: "in_progress" })).toBe("internal");
    expect(stageColour({ key: "pending_approval", category: "in_progress" })).toBe("pending");
    expect(stageColour({ key: "approved", category: "closed_positive" })).toBe("approved");
    expect(stageColour({ key: "revise_resubmit", category: "closed_negative" })).toBe("resubmitted");
  });

  it("colours a Stage it doesn't know by its category", () => {
    expect(stageColour({ key: "prepare", category: "draft" })).toBe("draft");
    expect(stageColour({ key: "check", category: "in_progress" })).toBe("pending");
    expect(stageColour({ key: "accepted", category: "closed_positive" })).toBe("approved");
    expect(stageColour({ key: "refused", category: "closed_negative" })).toBe("rejected");
    expect(stageColour({ key: "withdrawn", category: "cancelled" })).toBe("cancelled");
    expect(stageColour({ key: "constructor", category: "in_progress" })).toBe("pending");
  });
});
