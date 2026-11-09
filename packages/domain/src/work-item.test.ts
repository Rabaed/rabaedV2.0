import { describe, expect, it } from "vitest";
import { createWorkItemRequest, shownStepAgeWeeks } from "./work-item.ts";

describe("createWorkItemRequest", () => {
  const trade = "0192e0a0-0000-7000-8000-000000000001";

  it("trims the Subject; Trade and Location come in the answers, where the Form places them", () => {
    expect(createWorkItemRequest.parse({ type: "MAR", title: "  Cable trays ", answers: { trade } })).toEqual({
      type: "MAR",
      title: "Cable trays",
      answers: { trade },
    });
    expect(createWorkItemRequest.parse({ type: "MAR", title: "Cable trays" }).answers).toEqual({});
  });

  it("needs a Subject", () => {
    expect(createWorkItemRequest.safeParse({ type: "MAR", title: " ", answers: { trade } }).success).toBe(false);
  });
});

// RP-1263: the Panel and the item page show Step Age dots only while the item still moves. A cancelled
// item, which reads its Cancelled Stage from its outcome wherever it stopped, shows none.
describe("shownStepAgeWeeks", () => {
  const at = (category: "draft" | "in_progress" | "closed_positive" | "closed_negative" | "cancelled") => ({ stage: { category }, stepAgeWeeks: 5 });

  it("gives an open item's Step Age", () => {
    expect(shownStepAgeWeeks(at("in_progress"))).toBe(5);
    expect(shownStepAgeWeeks(at("draft"))).toBe(5);
  });

  it("gives none for a cancelled or closed item", () => {
    expect(shownStepAgeWeeks(at("cancelled"))).toBeNull();
    expect(shownStepAgeWeeks(at("closed_positive"))).toBeNull();
    expect(shownStepAgeWeeks(at("closed_negative"))).toBeNull();
  });
});
