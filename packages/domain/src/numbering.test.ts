import { describe, expect, it } from "vitest";
import cases from "./numbering-cases.json" with { type: "json" };
import {
  countsByParticipant,
  documentNumbering,
  numberingAttributes,
  numberingPattern,
  participantSegment,
  rabaedDefaultNumberingPattern,
  saveNumberingPatternRequest,
  type NumberingPattern,
} from "./numbering.ts";

// The cases in numbering-cases.json are shared with the database's builder
// (app.document_numbering and app.sequenced_document_number), whose seam-2 test
// runs the same table (packages/db/test/numbering-builder.test.ts): the two
// builders must agree (CODING_STANDARDS, Tests).
describe("documentNumbering, the shared cases", () => {
  it.each(cases)("$name", ({ pattern, item, seq, counterKey, number }) => {
    const n = documentNumbering(numberingPattern.parse(pattern), numberingAttributes.parse(item));
    expect(n.counterKey).toBe(counterKey);
    expect(n.number(seq)).toBe(number);
  });

  it("include the Rabaed Default as the domain defines it", () => {
    expect(cases.map((c) => c.pattern)).toContainEqual(rabaedDefaultNumberingPattern);
  });
});

const pattern = (p: Partial<NumberingPattern> & Pick<NumberingPattern, "segments">): NumberingPattern => ({
  separator: "-",
  seqDigits: 4,
  countedBy: p.segments.map((_, i) => i),
  ...p,
});

describe("a pattern to save (RP-313)", () => {
  const segments = [{ kind: "project" }, { kind: "type" }, { kind: "participant" }];
  const valid = (p: object) =>
    saveNumberingPatternRequest.safeParse({
      workItemTypeId: null,
      sharedCounterAccepted: false,
      pattern: { separator: "-", seqDigits: 4, segments, countedBy: [0, 1, 2], ...p },
    }).success;

  it("is up to 6 known segments, '-' or '/', and 3–7 digits", () => {
    expect(valid({})).toBe(true);
    expect(valid({ separator: "/", seqDigits: 3 })).toBe(true);
    expect(valid({ seqDigits: 7 })).toBe(true);
    expect(
      valid({ segments: [...segments, { kind: "trade" }, { kind: "location", level: 2 }, { kind: "text", text: "SUB" }] }),
    ).toBe(true);
  });

  it("is never more than 6 segments, an unknown segment, or digits outside 3–7", () => {
    expect(valid({ segments: [...segments, ...segments, { kind: "trade" }] })).toBe(false);
    expect(valid({ segments: [...segments, { kind: "building" }] })).toBe(false);
    expect(valid({ seqDigits: 2 })).toBe(false);
    expect(valid({ seqDigits: 8 })).toBe(false);
    expect(valid({ separator: "." })).toBe(false);
  });

  it("never counts by a segment it doesn't have, or by one twice", () => {
    expect(valid({ countedBy: [3] })).toBe(false);
    expect(valid({ countedBy: [0, 0, 2] })).toBe(false);
  });
});

describe("countsByParticipant", () => {
  it("is true only when the sequence counts separately for the Participant Code", () => {
    expect(countsByParticipant(rabaedDefaultNumberingPattern)).toBe(true);
    expect(countsByParticipant({ ...rabaedDefaultNumberingPattern, countedBy: [0, 1] })).toBe(false);
    expect(countsByParticipant(pattern({ segments: [{ kind: "project" }, { kind: "type" }], countedBy: [0, 1] }))).toBe(false);
  });
});

// RP-381: the Numbering page shows each Participant as its Document Numbers print it.
describe("participantSegment", () => {
  it("is the Participant Code once set, otherwise the order on the Project padded to two digits", () => {
    expect(participantSegment({ code: "CCM", ordinal: 3 })).toBe("CCM");
    expect(participantSegment({ code: null, ordinal: 2 })).toBe("02");
    expect(participantSegment({ code: null, ordinal: 123 })).toBe("123");
  });
});
