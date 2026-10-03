import { describe, expect, it } from "vitest";
import { createWorkItemRequest } from "./work-item.ts";

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
