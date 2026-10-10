import { describe, expect, it } from "vitest";
import { checkedOutcome, commandResult } from "./outcomes.ts";

describe("checkedOutcome", () => {
  const words = ["added", "not_found", "project_closed"] as const;

  it("answers with an outcome the caller expects", () => {
    expect(checkedOutcome("added", words)).toBe("added");
    expect(checkedOutcome("project_closed", words)).toBe("project_closed");
  });

  it("fails loudly on an outcome the SQL function gained but TypeScript doesn't know", () => {
    expect(() => checkedOutcome("too_deep", words)).toThrow(/too_deep/);
  });

  it("fails loudly on no outcome at all", () => {
    expect(() => checkedOutcome(null, words)).toThrow(/null/);
    expect(() => checkedOutcome(undefined, words)).toThrow(/undefined/);
  });
});

describe("commandResult", () => {
  const refusals = ["not_found", "item_closed"] as const;

  it("answers ok for the success word and a refusal for a known refusal", () => {
    expect(commandResult("picked_up", "picked_up", refusals)).toEqual({ ok: true });
    expect(commandResult("item_closed", "picked_up", refusals)).toEqual({ ok: false, reason: "item_closed" });
  });

  it("fails loudly on an outcome that is neither", () => {
    expect(() => commandResult("already_picked_up", "picked_up", refusals)).toThrow(/already_picked_up/);
  });
});
