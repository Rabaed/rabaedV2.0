import { describe, expect, it } from "vitest";
import { checkedOutcome, commandResult } from "./db-error.ts";

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
    expect(commandResult("claimed", "claimed", refusals)).toEqual({ ok: true });
    expect(commandResult("item_closed", "claimed", refusals)).toEqual({ ok: false, reason: "item_closed" });
  });

  it("fails loudly on an outcome that is neither", () => {
    expect(() => commandResult("already_claimed", "claimed", refusals)).toThrow(/already_claimed/);
  });
});
