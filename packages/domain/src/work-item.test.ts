import { describe, expect, it } from "vitest";
import { createWorkItemRequest } from "./work-item.ts";

describe("createWorkItemRequest", () => {
  const trade = "0192e0a0-0000-7000-8000-000000000001";

  it("trims the title and makes Location and the answers optional", () => {
    expect(createWorkItemRequest.parse({ type: "MAR", title: "  Cable trays ", tradeId: trade })).toEqual({
      type: "MAR",
      title: "Cable trays",
      tradeId: trade,
      locationId: null,
      answers: {},
    });
  });

  it("needs a title and a Trade", () => {
    expect(createWorkItemRequest.safeParse({ type: "MAR", title: " ", tradeId: trade }).success).toBe(false);
    expect(createWorkItemRequest.safeParse({ type: "MAR", title: "Cable trays" }).success).toBe(false);
  });
});
