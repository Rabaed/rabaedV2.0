import { describe, expect, it } from "vitest";
import { chainBucket, chainConditionKeys, holdsChainCondition, type ChainBucketCondition, type ChainBucketInput } from "./chain-bucket.ts";

const open = (over: Partial<ChainBucketInput> = {}): ChainBucketInput => ({
  outcomeKind: "review_code",
  stageCategory: "in_progress",
  outcome: null,
  submitted: false,
  raisedByViewer: false,
  ...over,
});

const closed = (over: Partial<ChainBucketInput>): ChainBucketInput => open({ stageCategory: "closed_positive", submitted: true, ...over });

describe("chainBucket", () => {
  describe("an open Revision", () => {
    it("is Pending once Submitted, for everyone who sees it", () => {
      expect(chainBucket(open({ submitted: true }))).toBe("pending");
      expect(chainBucket(open({ submitted: true, raisedByViewer: true }))).toBe("pending");
    });

    it("is Pending also while Sent Back to its raiser: it has been Submitted", () => {
      expect(chainBucket(open({ stageCategory: "draft", submitted: true, raisedByViewer: true }))).toBe("pending");
    });

    it("is In preparation in Draft or internal review, for the raiser's Participant", () => {
      expect(chainBucket(open({ stageCategory: "draft", raisedByViewer: true }))).toBe("in_preparation");
      expect(chainBucket(open({ stageCategory: "in_progress", raisedByViewer: true }))).toBe("in_preparation");
    });

    it("is in no bucket for anyone else before it is Submitted (V1)", () => {
      expect(chainBucket(open({ stageCategory: "draft" }))).toBeNull();
      expect(chainBucket(open())).toBeNull();
    });

    it("is Pending or In preparation whatever the Type's outcome kind", () => {
      for (const outcomeKind of ["review_code", "inspection_result", "none"] as const) {
        expect(chainBucket(open({ outcomeKind, submitted: true }))).toBe("pending");
        expect(chainBucket(open({ outcomeKind, raisedByViewer: true }))).toBe("in_preparation");
      }
    });
  });

  describe("a closed Revision", () => {
    it("is its Review Code", () => {
      expect(chainBucket(closed({ outcome: "A" }))).toBe("A");
      expect(chainBucket(closed({ outcome: "B" }))).toBe("B");
      expect(chainBucket(closed({ outcome: "C", stageCategory: "closed_negative" }))).toBe("C");
      expect(chainBucket(closed({ outcome: "D", stageCategory: "closed_negative" }))).toBe("D");
    });

    it("is its Inspection Result", () => {
      const inspection = { outcomeKind: "inspection_result" } as const;
      expect(chainBucket(closed({ ...inspection, outcome: "passed" }))).toBe("passed");
      expect(chainBucket(closed({ ...inspection, outcome: "passed_with_comments" }))).toBe("passed_with_comments");
      expect(chainBucket(closed({ ...inspection, outcome: "failed", stageCategory: "closed_negative" }))).toBe("failed");
    });

    it("is Approved or Rejected by its Stage for a Type with neither", () => {
      const none = { outcomeKind: "none", outcome: "closed" } as const;
      expect(chainBucket(closed({ ...none, stageCategory: "closed_positive" }))).toBe("approved");
      expect(chainBucket(closed({ ...none, stageCategory: "closed_negative" }))).toBe("rejected");
    });

    it("is Cancelled, whatever the outcome kind, by its outcome or its Stage", () => {
      for (const outcomeKind of ["review_code", "inspection_result", "none"] as const) {
        expect(chainBucket(closed({ outcomeKind, outcome: "cancelled", stageCategory: "cancelled" }))).toBe("cancelled");
        expect(chainBucket(closed({ outcomeKind, outcome: "cancelled", stageCategory: "closed_negative" }))).toBe("cancelled");
        expect(chainBucket(closed({ outcomeKind, outcome: null, stageCategory: "cancelled", submitted: false, raisedByViewer: true }))).toBe(
          "cancelled",
        );
      }
    });

    it("is never Pending or In preparation, Submitted or not", () => {
      expect(chainBucket(closed({ outcome: "A", submitted: false, raisedByViewer: true }))).toBe("A");
    });

    it("falls back to its Stage when its outcome doesn't belong to its Type's outcome kind", () => {
      expect(chainBucket(closed({ outcome: "passed", stageCategory: "closed_positive" }))).toBe("approved");
      expect(chainBucket(closed({ outcomeKind: "inspection_result", outcome: "C", stageCategory: "closed_negative" }))).toBe("rejected");
    });
  });
});

describe("holdsChainCondition", () => {
  it("reads every condition key: each one alone rules some chain out", () => {
    // Per key: a condition of that key alone, a chain it holds for, and one it doesn't.
    const cases: Record<keyof ChainBucketCondition, [ChainBucketCondition, ChainBucketInput, ChainBucketInput]> = {
      open: [{ open: true }, open(), closed({ outcome: "A" })],
      submitted: [{ submitted: true }, open({ submitted: true }), open()],
      raisedByViewer: [{ raisedByViewer: true }, open({ raisedByViewer: true }), open()],
      outcomeKind: [{ outcomeKind: "none" }, open({ outcomeKind: "none" }), open()],
      outcome: [{ outcome: "A" }, closed({ outcome: "A" }), open()],
      stageCategory: [{ stageCategory: "draft" }, open({ stageCategory: "draft" }), open()],
    };
    expect(chainConditionKeys.toSorted()).toEqual(Object.keys(cases).toSorted());
    for (const [key, [when, holding, notHolding]] of Object.entries(cases)) {
      expect(holdsChainCondition(when, holding), key).toBe(true);
      expect(holdsChainCondition(when, notHolding), key).toBe(false);
    }
  });

  it("refuses a key it doesn't read, rather than letting it hold", () => {
    expect(() => holdsChainCondition({ late: true } as ChainBucketCondition, open())).toThrow(/late/);
  });
});
