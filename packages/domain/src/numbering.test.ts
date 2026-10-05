import { describe, expect, it } from "vitest";
import { documentNumbering, rabaedDefaultNumberingPattern, type NumberingPattern } from "./numbering.ts";

/** A MAR raised by the Project's first Participant, on the Electrical Trade, at Floor F2 of Building B1 in Zone Z1. */
const item = {
  projectCode: "TWR",
  typeCode: "MAR",
  tradeCode: "EL",
  participant: { code: null, ordinal: 1 },
  locationPath: ["Z1", "B1", "F2"],
};

describe("the Rabaed Default", () => {
  it("numbers as Project, Type and the Participant's position, with 4 digits, counted by all three", () => {
    const n = documentNumbering(rabaedDefaultNumberingPattern, item);
    expect(n.number(1)).toBe("TWR-MAR-01-0001");
    expect(n.number(37)).toBe("TWR-MAR-01-0037");
    expect(n.counterKey).toBe("TWR-MAR-01");
  });

  it("prints the Participant Code once it is set, instead of the position", () => {
    const n = documentNumbering(rabaedDefaultNumberingPattern, { ...item, participant: { code: "CCM", ordinal: 3 } });
    expect(n.number(1)).toBe("TWR-MAR-CCM-0001");
    expect(n.counterKey).toBe("TWR-MAR-CCM");
  });

  it("pads the position to two digits and never cuts a longer one", () => {
    const at = (ordinal: number) =>
      documentNumbering(rabaedDefaultNumberingPattern, { ...item, participant: { code: null, ordinal } }).number(1);
    expect([at(7), at(12), at(123)]).toEqual(["TWR-MAR-07-0001", "TWR-MAR-12-0001", "TWR-MAR-123-0001"]);
  });

  it("never cuts a sequence longer than its digits", () => {
    expect(documentNumbering(rabaedDefaultNumberingPattern, item).number(12345)).toBe("TWR-MAR-01-12345");
  });
});

const pattern = (p: Partial<NumberingPattern> & Pick<NumberingPattern, "segments">): NumberingPattern => ({
  separator: "-",
  seqDigits: 4,
  countedBy: p.segments.map((_, i) => i),
  ...p,
});

describe("a Numbering Pattern", () => {
  it("prints the Trade code", () => {
    const n = documentNumbering(pattern({ segments: [{ kind: "project" }, { kind: "trade" }, { kind: "type" }] }), item);
    expect(n.number(4)).toBe("TWR-EL-MAR-0004");
    expect(n.counterKey).toBe("TWR-EL-MAR");
  });

  it("prints fixed text as it is", () => {
    const n = documentNumbering(pattern({ segments: [{ kind: "project" }, { kind: "text", text: "SUB" }, { kind: "type" }] }), item);
    expect(n.number(4)).toBe("TWR-SUB-MAR-0004");
  });

  it("prints the item's Location at the chosen level", () => {
    const at = (level: number) =>
      documentNumbering(pattern({ segments: [{ kind: "type" }, { kind: "location", level }] }), item).number(1);
    expect([at(1), at(2), at(3)]).toEqual(["MAR-Z1-0001", "MAR-B1-0001", "MAR-F2-0001"]);
  });

  it("prints the item's own Location when it sits above the chosen level", () => {
    const n = documentNumbering(pattern({ segments: [{ kind: "type" }, { kind: "location", level: 3 }] }), {
      ...item,
      locationPath: ["Z1", "B1"],
    });
    expect(n.number(1)).toBe("MAR-B1-0001");
    expect(n.counterKey).toBe("MAR-B1");
  });

  it("leaves the Location segment out for an item without a Location", () => {
    const n = documentNumbering(pattern({ segments: [{ kind: "type" }, { kind: "location", level: 2 }] }), {
      ...item,
      locationPath: [],
    });
    expect(n.number(1)).toBe("MAR-0001");
    expect(n.counterKey).toBe("MAR");
  });

  it("uses the separator throughout, and the sequence digits", () => {
    const n = documentNumbering(
      pattern({ segments: [{ kind: "project" }, { kind: "type" }, { kind: "participant" }], separator: "/", seqDigits: 5 }),
      item,
    );
    expect(n.number(144)).toBe("TWR/MAR/01/00144");
    // The key joins with "-" whatever the separator, so changing only the separator continues the count.
    expect(n.counterKey).toBe("TWR-MAR-01");
  });

  it("counts only by the ticked segments, so unticked ones share one count", () => {
    const shared = pattern({
      segments: [{ kind: "project" }, { kind: "type" }, { kind: "trade" }, { kind: "participant" }],
      countedBy: [0, 1],
    });
    const mine = documentNumbering(shared, item);
    const theirs = documentNumbering(shared, { ...item, tradeCode: "ME", participant: { code: "KCC", ordinal: 2 } });
    expect(mine.counterKey).toBe("TWR-MAR");
    expect(theirs.counterKey).toBe(mine.counterKey);
    expect(theirs.number(2)).toBe("TWR-MAR-ME-KCC-0002");
  });
});
