import { describe, expect, it } from "vitest";
import { pageNumbers } from "./numbered-pager.tsx";

describe("the pager's page numbers (RP-409)", () => {
  it("shows every page when there are few", () => {
    expect(pageNumbers(1, 2, false)).toEqual([1, 2]);
    expect(pageNumbers(4, 7, true)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("shows the first, the last and the pages around this one when there are many, with gaps", () => {
    expect(pageNumbers(1, 20, true)).toEqual([1, 2, "gap", 20]);
    expect(pageNumbers(10, 20, true)).toEqual([1, "gap", 9, 10, 11, "gap", 20]);
    expect(pageNumbers(20, 20, false)).toEqual([1, "gap", 19, 20]);
  });

  it("under a search, with no last page, grows as the pages are read: this one and the next when there is one", () => {
    expect(pageNumbers(1, null, true)).toEqual([1, 2]);
    expect(pageNumbers(3, null, true)).toEqual([1, 2, 3, 4]);
    expect(pageNumbers(3, null, false)).toEqual([1, 2, 3]);
    expect(pageNumbers(12, null, true)).toEqual([1, "gap", 11, 12, 13]);
  });
});
