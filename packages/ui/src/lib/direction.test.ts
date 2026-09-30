import { describe, expect, it } from "vitest";
import { physicalSide } from "./direction.ts";

describe("physicalSide", () => {
  it("puts start on the left and end on the right in English", () => {
    expect(physicalSide("start", "ltr")).toBe("left");
    expect(physicalSide("end", "ltr")).toBe("right");
  });

  it("mirrors them in Arabic", () => {
    expect(physicalSide("start", "rtl")).toBe("right");
    expect(physicalSide("end", "rtl")).toBe("left");
  });
});
