import { rabaedDefaultNumberingPattern, type NumberingAttributes, type NumberingPattern } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { addSegment, moveSegment, nextSequences, patternNumber, removeSegment, setCounted, sharesCounter } from "./numbering-model.ts";

const item = (tradeCode: string | null, code: string | null = "TMC"): NumberingAttributes => ({
  projectCode: "TWR",
  typeCode: "MAR",
  tradeCode,
  participant: { code, ordinal: 1 },
  locationPath: ["Z1", "T1", "F01"],
});

const kit: NumberingPattern = {
  segments: [{ kind: "project" }, { kind: "participant" }, { kind: "trade" }, { kind: "type" }],
  separator: "-",
  seqDigits: 3,
  countedBy: [0, 1, 2, 3],
};

describe("patternNumber", () => {
  it("gives the number in coloured parts and whole, as the domain builds it", () => {
    const n = patternNumber(kit, item("EL"), 42);
    expect(n.text).toBe("TWR-TMC-EL-MAR-042");
    expect(n.parts.map((p) => [p.kind, p.text])).toEqual([
      ["project", "TWR"],
      ["participant", "TMC"],
      ["trade", "EL"],
      ["type", "MAR"],
      ["sequence", "042"],
    ]);
    expect(n.counterKey).toBe("TWR-TMC-EL-MAR");
  });

  it("leaves out a value the item doesn't have", () => {
    expect(patternNumber(kit, item(null), 1).parts.map((p) => p.kind)).toEqual(["project", "participant", "type", "sequence"]);
  });
});

describe("nextSequences", () => {
  const items = [item("EL"), item("CV"), item("EL", "GLF")];

  it("without counters, numbers examples from 1: counted apart each start at 1, counted together continue", () => {
    expect(nextSequences(kit, items)).toEqual([1, 1, 1]);
    const shared = setCounted(kit, "trade", false);
    expect(nextSequences(shared, items)).toEqual([1, 2, 1]);
    expect(nextSequences(setCounted(shared, "participant", false), items)).toEqual([1, 2, 3]);
  });

  it("with the Project Admin's counters, gives each item its counter's next number", () => {
    const counters = [
      { counterKey: "TWR-TMC-EL-MAR", lastValue: 41, startingNumber: null, issued: true },
      { counterKey: "TWR-TMC-CV-MAR", lastValue: 143, startingNumber: 144, issued: false },
    ];
    expect(nextSequences(kit, items, counters)).toEqual([42, 144, 1]);
  });
});

describe("pattern edits", () => {
  it("count a new Project or Company segment separately, others not", () => {
    const p: NumberingPattern = { segments: [{ kind: "type" }], separator: "-", seqDigits: 4, countedBy: [0] };
    expect(addSegment(addSegment(p, "trade"), "participant").countedBy).toEqual([0, 2]);
  });

  it("keep each segment's tick with it when moved or when another is removed", () => {
    const p = setCounted(kit, "trade", false); // ticks on project, Company, Type
    const moved = moveSegment(p, 2, 0); // Trade first
    expect(moved.segments.map((s) => s.kind)).toEqual(["trade", "project", "participant", "type"]);
    expect(moved.countedBy).toEqual([1, 2, 3]);
    expect(removeSegment(moved, 1).countedBy).toEqual([1, 2]);
  });

  it("stop at six segments and keep at least one", () => {
    let p = rabaedDefaultNumberingPattern;
    for (let i = 0; i < 5; i += 1) p = addSegment(p, "text");
    expect(p.segments).toHaveLength(6);
    expect(removeSegment({ ...kit, segments: [{ kind: "type" }], countedBy: [0] }, 0).segments).toHaveLength(1);
  });

  it("warn of a shared counter without a counted Company segment", () => {
    expect(sharesCounter(kit)).toBe(false);
    expect(sharesCounter(setCounted(kit, "participant", false))).toBe(true);
    expect(sharesCounter(removeSegment(kit, 1))).toBe(true);
  });
});
