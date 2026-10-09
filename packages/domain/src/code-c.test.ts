import { describe, expect, it } from "vitest";
import { chainOutcomeTraits } from "./chain-bucket.ts";
import { codeCFilterStates, codeCState, type CodeCInput } from "./code-c.ts";
import { defaultOutcomeSets, type Outcome } from "./outcome.ts";

/**
 * A chain that has had a Code C, by its latest visible Revision: here a Code C
 * original nobody has revised yet. Its outcome is read from its Type's set (the
 * Review Codes unless `set`).
 */
const chain = ({ set = defaultOutcomeSets.review_code, ...over }: Partial<CodeCInput> & { set?: readonly Outcome[] } = {}): CodeCInput => ({
  stageCategory: "closed_negative",
  outcome: "C",
  submitted: true,
  raisedByViewer: false,
  hadCodeC: true,
  ...chainOutcomeTraits(set, over.outcome === undefined ? "C" : over.outcome),
  ...over,
});

const revision = (over: Partial<CodeCInput> = {}) => chain({ stageCategory: "draft", outcome: null, submitted: false, ...over });

describe("codeCState", () => {
  it("is approved on revision when the latest Revision got Code A or B", () => {
    expect(codeCState(chain({ stageCategory: "closed_positive", outcome: "A" }))).toBe("approvedOnRevision");
    expect(codeCState(chain({ stageCategory: "closed_positive", outcome: "B", raisedByViewer: true }))).toBe("approvedOnRevision");
  });

  it("is rejected after C when the latest Revision got Code D", () => {
    expect(codeCState(chain({ outcome: "D" }))).toBe("rejectedAfterC");
    expect(codeCState(chain({ outcome: "D", raisedByViewer: true }))).toBe("rejectedAfterC");
  });

  describe("awaiting revision", () => {
    it("is one figure for another Company, whether a Revision is under way or not", () => {
      expect(codeCState(chain())).toBe("awaitingRevision");
      // Rev 1 Submitted and with the Consultant.
      expect(codeCState(revision({ stageCategory: "in_progress", submitted: true }))).toBe("awaitingRevision");
    });

    it("is \"no Revision yet\" for the raiser's Participant while the Code C Revision is its latest", () => {
      expect(codeCState(chain({ raisedByViewer: true }))).toBe("noRevisionYet");
    });

    it("is \"Revision in progress\" for the raiser's Participant once a Revision is open, Submitted or not", () => {
      expect(codeCState(revision({ raisedByViewer: true }))).toBe("revisionInProgress");
      expect(codeCState(revision({ stageCategory: "in_progress", raisedByViewer: true }))).toBe("revisionInProgress");
      expect(codeCState(revision({ stageCategory: "in_progress", submitted: true, raisedByViewer: true }))).toBe("revisionInProgress");
      // Sent Back to the raiser after it was Submitted.
      expect(codeCState(revision({ stageCategory: "draft", submitted: true, raisedByViewer: true }))).toBe("revisionInProgress");
    });

    it("counts a Revision that got Code C again as still awaiting one", () => {
      expect(codeCState(chain({ outcome: "C" }))).toBe("awaitingRevision");
    });
  });

  it("counts nowhere a chain that never had a Code C the viewer sees", () => {
    expect(codeCState(chain({ hadCodeC: false }))).toBeNull();
    expect(codeCState(chain({ hadCodeC: false, stageCategory: "closed_positive", outcome: "A" }))).toBeNull();
  });

  it("counts nowhere a Type with no outcome offering a Revision", () => {
    expect(codeCState(chain({ set: defaultOutcomeSets.inspection_result, outcome: "failed", hadCodeC: false }))).toBeNull();
    expect(codeCState(chain({ set: defaultOutcomeSets.none, outcome: "closed", hadCodeC: false }))).toBeNull();
  });

  it("reads an outcome a Project Admin added by its polarity: a positive one is approved on revision", () => {
    const set: Outcome[] = [
      ...defaultOutcomeSets.review_code,
      { code: "E", name: { en: "Approved for construction only", ar: "معتمد للتنفيذ فقط" }, closing: true, polarity: "positive", actions: [] },
    ];
    expect(codeCState(chain({ set, stageCategory: "closed_positive", outcome: "E" }))).toBe("approvedOnRevision");
  });

  it("counts nowhere a cancelled latest Revision", () => {
    expect(codeCState(chain({ stageCategory: "cancelled", outcome: "cancelled" }))).toBeNull();
    expect(codeCState(chain({ stageCategory: "cancelled", outcome: "C" }))).toBeNull();
  });

  it("counts nowhere an unsubmitted Revision another Company somehow sees (V1)", () => {
    expect(codeCState(revision())).toBeNull();
  });
});

describe("codeCFilterStates", () => {
  it("takes in both halves of the raiser's split under awaiting revision", () => {
    expect(codeCFilterStates(["awaitingRevision"]).sort()).toEqual(["awaitingRevision", "noRevisionYet", "revisionInProgress"]);
    expect(codeCFilterStates(["noRevisionYet"])).toEqual(["noRevisionYet"]);
    expect(codeCFilterStates(["approvedOnRevision", "rejectedAfterC"])).toEqual(["approvedOnRevision", "rejectedAfterC"]);
  });
});
