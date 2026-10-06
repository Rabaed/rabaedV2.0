import { describe, expect, it } from "vitest";
import type { ChainBucket } from "./chain-bucket.ts";
import type { CodeCState } from "./code-c.ts";
import { dashboardCard, type DashboardCard } from "./dashboard.ts";

const mar = { code: "MAR", name: { en: "Material Submittal", ar: "اعتماد المواد" } };
const counts = (entries: [ChainBucket | null, number][]) => new Map(entries);

function outcomes(card: DashboardCard) {
  if (card.kind !== "outcomes") throw new Error("expected an outcomes card");
  return card;
}

describe("dashboardCard", () => {
  it("shows a Review Code Type's bars in order: Pending, Revise (C), Approved (A), Approved (B), Rejected (D)", () => {
    const card = outcomes(
      dashboardCard({ type: mar, moduleKey: "submittals", outcomeKind: "review_code", counts: counts([["pending", 4], ["A", 6], ["B", 4], ["C", 2], ["D", 1]]) }),
    );
    expect(card.bars.map((b) => [b.bucket, b.count])).toEqual([
      ["pending", 4],
      ["C", 2],
      ["A", 6],
      ["B", 4],
      ["D", 1],
    ]);
  });

  it("shows an Inspection Result Type's bars: Pending, Passed, Passed with Comments, Failed", () => {
    const card = outcomes(
      dashboardCard({ type: mar, moduleKey: "inspections", outcomeKind: "inspection_result", counts: counts([["passed", 3], ["failed", 1]]) }),
    );
    expect(card.bars.map((b) => [b.bucket, b.count])).toEqual([
      ["pending", 0],
      ["passed", 3],
      ["passed_with_comments", 0],
      ["failed", 1],
    ]);
  });

  it("shows a Type with neither Pending, Approved and Rejected", () => {
    const card = outcomes(dashboardCard({ type: mar, moduleKey: "site_reports", outcomeKind: "none", counts: counts([["approved", 2], ["rejected", 1]]) }));
    expect(card.bars.map((b) => [b.bucket, b.count])).toEqual([
      ["pending", 0],
      ["approved", 2],
      ["rejected", 1],
    ]);
  });

  it("counts every chain in the total, Cancelled and In preparation too, and the Approved % over the Submitted ones", () => {
    const card = outcomes(
      dashboardCard({
        type: mar,
        moduleKey: "submittals",
        outcomeKind: "review_code",
        counts: counts([["pending", 2], ["A", 3], ["B", 1], ["cancelled", 1], ["in_preparation", 1]]),
      }),
    );
    expect(card.total.count).toBe(8);
    expect(card.approved).toMatchObject({ count: 4, percent: 57 });
    const inspection = outcomes(
      dashboardCard({ type: mar, moduleKey: "inspections", outcomeKind: "inspection_result", counts: counts([["passed", 1], ["passed_with_comments", 1], ["failed", 1]]) }),
    );
    expect(inspection.approved).toMatchObject({ count: 2, percent: 67 });
    const none = outcomes(dashboardCard({ type: mar, moduleKey: "site_reports", outcomeKind: "none", counts: counts([["approved", 1], ["rejected", 3]]) }));
    expect(none.approved).toMatchObject({ count: 1, percent: 25 });
  });

  it("gives the raiser's Participant and every other Company the same Approved % for the same Submitted chains", () => {
    const submitted: [ChainBucket, number][] = [["pending", 1], ["A", 2], ["C", 1]];
    const raiser = outcomes(
      dashboardCard({ type: mar, moduleKey: "submittals", outcomeKind: "review_code", counts: counts([...submitted, ["in_preparation", 3]]) }),
    );
    const other = outcomes(dashboardCard({ type: mar, moduleKey: "submittals", outcomeKind: "review_code", counts: counts(submitted) }));
    expect(raiser.approved).toMatchObject({ count: 2, percent: 50 });
    expect(other.approved).toMatchObject({ count: 2, percent: 50 });
  });

  it("shows 0% for a Type with no chains", () => {
    const card = outcomes(dashboardCard({ type: mar, moduleKey: "submittals", outcomeKind: "review_code", counts: counts([]) }));
    expect(card.total.count).toBe(0);
    expect(card.approved).toMatchObject({ count: 0, percent: 0 });
  });

  it("shows In preparation only when the viewer's Participant has some", () => {
    const own = outcomes(dashboardCard({ type: mar, moduleKey: "submittals", outcomeKind: "review_code", counts: counts([["in_preparation", 3]]) }));
    expect(own.inPreparation).toEqual({ count: 3, query: { module: "submittals", type: ["MAR"], bucket: ["in_preparation"] } });
    const theirs = outcomes(dashboardCard({ type: mar, moduleKey: "submittals", outcomeKind: "review_code", counts: counts([["pending", 4]]) }));
    expect(theirs.inPreparation).toBeNull();
  });

  it("gives every number the List filter that reproduces it", () => {
    const card = outcomes(dashboardCard({ type: mar, moduleKey: "submittals", outcomeKind: "review_code", counts: counts([["A", 1]]) }));
    expect(card.total.query).toEqual({ module: "submittals", type: ["MAR"], bucket: [] });
    expect(card.bars.find((b) => b.bucket === "C")!.query).toEqual({ module: "submittals", type: ["MAR"], bucket: ["C"] });
    expect(card.approved.query).toEqual({ module: "submittals", type: ["MAR"], bucket: ["A", "B"] });
  });

  it("shows the Snag List's Types as open and closed, Cancelled among the closed", () => {
    const card = dashboardCard({
      type: { code: "SNG", name: { en: "Snags", ar: "الملاحظات" } },
      moduleKey: "snag_list",
      outcomeKind: "none",
      counts: counts([["pending", 2], ["in_preparation", 1], ["approved", 4], ["rejected", 1], ["cancelled", 1], [null, 2]]),
    });
    if (card.kind !== "open_closed") throw new Error("expected an open/closed card");
    expect(card.open).toEqual({ count: 3, query: { module: "snag_list", type: ["SNG"], bucket: ["pending", "in_preparation"] } });
    expect(card.closed.count).toBe(6);
    expect(card.closed.query.bucket).toEqual(expect.arrayContaining(["approved", "rejected", "cancelled", "A", "passed"]));
    expect(card.closed.query.bucket).not.toContain("pending");
    expect(card.total.count).toBe(9);
    expect(card.open.count + card.closed.count).toBe(card.total.count);
  });

  it("counts a chain in no bucket nowhere, not even in the total", () => {
    const card = outcomes(dashboardCard({ type: mar, moduleKey: "submittals", outcomeKind: "review_code", counts: counts([[null, 1], ["pending", 1]]) }));
    expect(card.total.count).toBe(1);
    expect(card.bars.reduce((sum, b) => sum + b.count, 0)).toBe(1);
  });

  it("names the card's Module in every number's query", () => {
    const card = outcomes(dashboardCard({ type: mar, moduleKey: "inspections", outcomeKind: "inspection_result", counts: counts([["passed", 1]]) }));
    expect([card.total, card.approved, ...card.bars].map((f) => f.query.module)).toEqual(Array(6).fill("inspections"));
  });

  describe("the Code C line", () => {
    const codeC = (entries: [CodeCState | null, number][]) => new Map(entries);
    const line = (entries: [CodeCState | null, number][], outcomeKind: "review_code" | "inspection_result" = "review_code") =>
      outcomes(dashboardCard({ type: mar, moduleKey: "submittals", outcomeKind, counts: counts([["A", 1]]), codeCCounts: codeC(entries) })).codeC;

    it("reads Code C 5 · approved on revision 3 (60%) · awaiting revision 2", () => {
      const c = line([["approvedOnRevision", 3], ["awaitingRevision", 2], [null, 7]])!;
      expect(c.total).toEqual({ count: 5, query: { module: "submittals", type: ["MAR"], bucket: [], codeC: ["approvedOnRevision", "awaitingRevision", "rejectedAfterC"] } });
      expect(c.approvedOnRevision).toEqual({ count: 3, percent: 60, query: { module: "submittals", type: ["MAR"], bucket: [], codeC: ["approvedOnRevision"] } });
      expect(c.awaitingRevision).toEqual({ count: 2, query: { module: "submittals", type: ["MAR"], bucket: [], codeC: ["awaitingRevision"] } });
      expect(c.rejectedAfterC).toBeNull();
      expect(c.split).toBeNull();
    });

    it("adds rejected after C when there is any", () => {
      const c = line([["approvedOnRevision", 1], ["rejectedAfterC", 1]])!;
      expect(c.total.count).toBe(2);
      expect(c.approvedOnRevision.percent).toBe(50);
      expect(c.rejectedAfterC).toEqual({ count: 1, query: { module: "submittals", type: ["MAR"], bucket: [], codeC: ["rejectedAfterC"] } });
    });

    it("splits awaiting revision for the raiser's Participant, and counts it whole", () => {
      const c = line([["noRevisionYet", 1], ["revisionInProgress", 2], ["awaitingRevision", 1]])!;
      expect(c.total.count).toBe(4);
      expect(c.awaitingRevision.count).toBe(4);
      expect(c.split).toEqual({
        noRevisionYet: { count: 1, query: { module: "submittals", type: ["MAR"], bucket: [], codeC: ["noRevisionYet"] } },
        revisionInProgress: { count: 2, query: { module: "submittals", type: ["MAR"], bucket: [], codeC: ["revisionInProgress"] } },
      });
      expect(line([["revisionInProgress", 1]])!.split?.noRevisionYet.count).toBe(0);
    });

    it("is left out when no chain has had a Code C, and on a Type without Review Codes", () => {
      expect(line([])).toBeNull();
      expect(line([[null, 3]])).toBeNull();
      expect(line([["awaitingRevision", 1]], "inspection_result")).toBeNull();
      expect(outcomes(dashboardCard({ type: mar, moduleKey: "submittals", outcomeKind: "review_code", counts: counts([]) })).codeC).toBeNull();
    });
  });
});
