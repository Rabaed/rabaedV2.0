import { describe, expect, it } from "vitest";
import {
  chainBucket,
  chainConditionKeys,
  chainOutcomeTraits,
  holdsChainCondition,
  type ChainBucketCondition,
  type ChainBucketInput,
} from "./chain-bucket.ts";
import { defaultOutcomeSets, type Outcome, type OutcomeKind } from "./outcome.ts";

type Over = Partial<ChainBucketInput> & { set?: readonly Outcome[] };

/** A chain's latest visible Revision, its outcome read from its Type's set (the Review Codes unless `set`). */
const open = ({ set = defaultOutcomeSets.review_code, ...over }: Over = {}): ChainBucketInput => ({
  stageCategory: "in_progress",
  outcome: null,
  submitted: false,
  raisedByViewer: false,
  ...chainOutcomeTraits(set, over.outcome ?? null),
  ...over,
});

const closed = (over: Over): ChainBucketInput => open({ stageCategory: "closed_positive", submitted: true, ...over });

const kinds = Object.keys(defaultOutcomeSets) as OutcomeKind[];

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

    it("is Pending or In preparation whatever the Type's outcome set", () => {
      for (const kind of kinds) {
        const set = defaultOutcomeSets[kind];
        expect(chainBucket(open({ set, submitted: true }))).toBe("pending");
        expect(chainBucket(open({ set, raisedByViewer: true }))).toBe("in_preparation");
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
      const set = defaultOutcomeSets.inspection_result;
      expect(chainBucket(closed({ set, outcome: "passed" }))).toBe("passed");
      expect(chainBucket(closed({ set, outcome: "passed_with_comments" }))).toBe("passed_with_comments");
      expect(chainBucket(closed({ set, outcome: "failed", stageCategory: "closed_negative" }))).toBe("failed");
    });

    it("is an outcome a Project Admin added to its Type's set", () => {
      const set: Outcome[] = [
        ...defaultOutcomeSets.review_code,
        { code: "E", name: { en: "Approved for construction only", ar: "معتمد للتنفيذ فقط" }, closing: true, polarity: "positive", actions: [] },
      ];
      expect(chainBucket(closed({ set, outcome: "E" }))).toBe("E");
    });

    it("is Approved or Rejected by its Stage for a Type with one closing outcome", () => {
      const none = { set: defaultOutcomeSets.none, outcome: "closed" } as const;
      expect(chainBucket(closed({ ...none, stageCategory: "closed_positive" }))).toBe("approved");
      expect(chainBucket(closed({ ...none, stageCategory: "closed_negative" }))).toBe("rejected");
    });

    it("is Cancelled, whatever the outcome set, by its outcome or its Stage", () => {
      for (const kind of kinds) {
        const set = defaultOutcomeSets[kind];
        expect(chainBucket(closed({ set, outcome: "cancelled", stageCategory: "cancelled" }))).toBe("cancelled");
        expect(chainBucket(closed({ set, outcome: "cancelled", stageCategory: "closed_negative" }))).toBe("cancelled");
        expect(chainBucket(closed({ set, outcome: null, stageCategory: "cancelled", submitted: false, raisedByViewer: true }))).toBe("cancelled");
      }
    });

    it("is never Pending or In preparation, Submitted or not", () => {
      expect(chainBucket(closed({ outcome: "A", submitted: false, raisedByViewer: true }))).toBe("A");
    });

    it("falls back to its Stage when its outcome doesn't belong to its Type's set", () => {
      expect(chainBucket(closed({ outcome: "passed", stageCategory: "closed_positive" }))).toBe("approved");
      expect(chainBucket(closed({ set: defaultOutcomeSets.inspection_result, outcome: "C", stageCategory: "closed_negative" }))).toBe("rejected");
    });
  });
});

describe("chainOutcomeTraits", () => {
  it("reads an outcome's polarity, its Revision and whether it is a bar from its Type's set", () => {
    expect(chainOutcomeTraits(defaultOutcomeSets.review_code, "C")).toEqual({ outcomeBar: true, polarity: "negative", offersRevision: true });
    expect(chainOutcomeTraits(defaultOutcomeSets.review_code, "A")).toEqual({ outcomeBar: true, polarity: "positive", offersRevision: false });
    expect(chainOutcomeTraits(defaultOutcomeSets.none, "closed")).toEqual({ outcomeBar: false, polarity: "positive", offersRevision: false });
  });

  it("reads nothing for an open item, a cancelled one, or an outcome not in the set", () => {
    const nothing = { outcomeBar: false, polarity: null, offersRevision: false };
    for (const outcome of [null, "cancelled", "passed"]) expect(chainOutcomeTraits(defaultOutcomeSets.review_code, outcome)).toEqual(nothing);
  });
});

describe("holdsChainCondition", () => {
  it("reads every condition key: each one alone rules some chain out", () => {
    // Per key: a condition of that key alone, a chain it holds for, and one it doesn't.
    const cases: Record<keyof ChainBucketCondition, [ChainBucketCondition, ChainBucketInput, ChainBucketInput]> = {
      open: [{ open: true }, open(), closed({ outcome: "A" })],
      submitted: [{ submitted: true }, open({ submitted: true }), open()],
      raisedByViewer: [{ raisedByViewer: true }, open({ raisedByViewer: true }), open()],
      outcome: [{ outcome: "A" }, closed({ outcome: "A" }), open()],
      stageCategory: [{ stageCategory: "draft" }, open({ stageCategory: "draft" }), open()],
      outcomeBar: [{ outcomeBar: true }, closed({ outcome: "A" }), closed({ set: defaultOutcomeSets.none, outcome: "closed" })],
      polarity: [{ polarity: "negative" }, closed({ outcome: "D" }), closed({ outcome: "A" })],
      offersRevision: [{ offersRevision: true }, closed({ outcome: "C" }), closed({ outcome: "D" })],
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
