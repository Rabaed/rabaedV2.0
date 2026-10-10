import { describe, expect, it } from "vitest";
import { codeAfterLabel } from "./history-code.ts";

describe("codeAfterLabel (the Download's history, RP-409)", () => {
  it("shows the Code once when the label already names it", () => {
    expect(codeAfterLabel("Approve · A", "A")).toBeNull();
    expect(codeAfterLabel("اعتماد · A", "A")).toBeNull();
    expect(codeAfterLabel("Revise and resubmit · C", "C")).toBeNull();
  });

  it("adds the Code when the label doesn't name it", () => {
    expect(codeAfterLabel("Issue Code", "B")).toBe("B");
    expect(codeAfterLabel("Approve", "A")).toBe("A");
    expect(codeAfterLabel(null, "C")).toBe("C");
  });

  it("never matches a letter inside a word", () => {
    expect(codeAfterLabel("Approve as noted", "A")).toBe("A");
  });

  it("has nothing to add without a Code", () => {
    expect(codeAfterLabel("Submit", null)).toBeNull();
  });
});
