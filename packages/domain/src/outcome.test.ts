import { describe, expect, it } from "vitest";
import outcomeCases from "./outcome-cases.json" with { type: "json" };
import {
  addOutcomeRequest,
  changeOutcomeRequest,
  dashboardBarOutcomes,
  defaultOutcomeSets,
  itemsToCreate,
  offersReplacement,
  offersRevision,
  outcomeActions,
  outcomeCode,
  outcomeLabel,
  outcomeLook,
  outcomeSchema,
  type Outcome,
} from "./outcome.ts";

const codes = (set: readonly Outcome[]) => set.map((o) => o.code);

describe("the Rabaed Default outcome sets", () => {
  it("are the Review Codes A, B, C, D, the Inspection Results, Approved and Rejected, and Closed", () => {
    expect(codes(defaultOutcomeSets.review_code)).toEqual(["A", "B", "C", "D"]);
    expect(codes(defaultOutcomeSets.inspection_result)).toEqual(["passed", "passed_with_comments", "failed"]);
    expect(codes(defaultOutcomeSets.approval)).toEqual(["approved", "rejected"]);
    expect(codes(defaultOutcomeSets.none)).toEqual(["closed"]);
  });

  it("close the item, each positive or negative, named in English and Arabic", () => {
    const all = Object.values(defaultOutcomeSets).flat();
    for (const o of all) expect(outcomeSchema.parse(o)).toEqual(o);
    expect(all.every((o) => o.closing)).toBe(true);
    const polarity = (set: readonly Outcome[]) => set.map((o) => o.polarity);
    expect(polarity(defaultOutcomeSets.review_code)).toEqual(["positive", "positive", "negative", "negative"]);
    expect(polarity(defaultOutcomeSets.inspection_result)).toEqual(["positive", "positive", "negative"]);
    expect(polarity(defaultOutcomeSets.approval)).toEqual(["positive", "negative"]);
    expect(polarity(defaultOutcomeSets.none)).toEqual(["positive"]);
  });

  it("give Code B Comments to create, Code C a Revision and Code D a replacement", () => {
    const [a, b, c, d] = defaultOutcomeSets.review_code;
    expect(itemsToCreate(b!)).toBe("CMT");
    expect([a, c, d].map((o) => itemsToCreate(o!))).toEqual([null, null, null]);
    expect([a, b, c, d].map((o) => offersRevision(o!))).toEqual([false, false, true, false]);
    expect([a, b, c, d].map((o) => offersReplacement(o!))).toEqual([false, false, false, true]);
    expect(Object.values(defaultOutcomeSets).flat().filter((o) => o.actions.length > 0).map((o) => o.code)).toEqual(["B", "C", "D"]);
  });
});

// The cases app.is_outcome_code and app.is_outcome_actions run over too (seam-2 outcome-sets.test.ts).
describe("an outcome code: a letter, then letters, digits or underscores, at most 32, never one the engine or the Dashboard keeps", () => {
  it.each(outcomeCases.codes)("$code: $valid", ({ code, valid }) => {
    expect(outcomeCode.safeParse(code).success).toBe(valid);
  });
});

describe("an outcome's follow-up actions: each of the three kinds at most once, items of a Type code", () => {
  it.each(outcomeCases.actions)("$name: $valid", ({ actions, valid }) => {
    expect(outcomeActions.safeParse(actions).success).toBe(valid);
  });
});

describe("a Project Admin's outcome", () => {
  const e = {
    code: "E",
    name: { en: "Approved for construction only", ar: "معتمد للتنفيذ فقط" },
    closing: true,
    polarity: "positive",
    actions: [],
  };

  it("is added with its code, names, closing, polarity and follow-up actions", () => {
    expect(addOutcomeRequest.parse(e)).toEqual(e);
    expect(addOutcomeRequest.parse({ ...e, actions: [{ kind: "create_items", type: "CMT" }, { kind: "offer_revision" }] }).actions).toHaveLength(2);
  });

  it("takes each follow-up action once, and items to create only of a Type code", () => {
    expect(addOutcomeRequest.safeParse({ ...e, actions: [{ kind: "offer_revision" }, { kind: "offer_revision" }] }).success).toBe(false);
    expect(addOutcomeRequest.safeParse({ ...e, actions: [{ kind: "create_items", type: "comments" }] }).success).toBe(false);
    expect(addOutcomeRequest.safeParse({ ...e, actions: [{ kind: "notify" }] }).success).toBe(false);
  });

  it("is changed by its names and follow-up actions, and may ask for a new code, closing and polarity (kept when left out)", () => {
    expect(changeOutcomeRequest.parse({ name: e.name, actions: [{ kind: "offer_replacement" }] })).toEqual({
      name: e.name,
      actions: [{ kind: "offer_replacement" }],
    });
    expect(changeOutcomeRequest.parse({ name: e.name, actions: [], code: "E1", closing: false, polarity: "negative" })).toMatchObject({
      code: "E1",
      closing: false,
      polarity: "negative",
    });
    expect(changeOutcomeRequest.safeParse({ name: e.name, actions: [], polarity: "neutral" }).success).toBe(false);
    expect(changeOutcomeRequest.safeParse({ name: e.name, actions: [], code: "pending" }).success).toBe(false);
  });
});

describe("dashboardBarOutcomes", () => {
  it("puts outcomes offering a Revision first, then the positive, then the negative, each in the set's order", () => {
    expect(codes(dashboardBarOutcomes(defaultOutcomeSets.review_code))).toEqual(["C", "A", "B", "D"]);
    expect(codes(dashboardBarOutcomes(defaultOutcomeSets.inspection_result))).toEqual(["passed", "passed_with_comments", "failed"]);
  });

  it("takes an outcome a Project Admin added, and leaves out one that doesn't close", () => {
    const set: Outcome[] = [
      ...defaultOutcomeSets.review_code,
      { code: "E", name: { en: "Approved for construction only", ar: "معتمد للتنفيذ فقط" }, closing: true, polarity: "positive", actions: [] },
      { code: "H", name: { en: "On hold", ar: "معلق" }, closing: false, polarity: "negative", actions: [] },
    ];
    expect(codes(dashboardBarOutcomes(set))).toEqual(["C", "A", "B", "E", "D"]);
  });

  it("gives no bars for a set with one closing outcome: those count by their Stage, Approved or Rejected", () => {
    expect(dashboardBarOutcomes(defaultOutcomeSets.none)).toEqual([]);
  });
});

describe("outcomeLabel", () => {
  it("names a letter code with its letter, and any other by its name", () => {
    const [a] = defaultOutcomeSets.review_code;
    expect(outcomeLabel(a!, "en")).toBe("Approved (A)");
    expect(outcomeLabel(a!, "ar")).toBe("معتمد (A)");
    expect(outcomeLabel(defaultOutcomeSets.inspection_result[0]!, "en")).toBe("Passed");
  });
});

describe("outcomeLook (RP-410): how a card shows its outcome, from its place in its Type's set", () => {
  const set = defaultOutcomeSets.review_code;
  const look = (code: string, of: readonly Outcome[] = set) => outcomeLook(of.find((o) => o.code === code)!, of);

  it("gives the Review Codes their own looks: A the clean approval, B approved with more to do, C a Revision, D rejected", () => {
    expect(["A", "B", "C", "D"].map((c) => look(c))).toEqual(["a", "b", "c", "d"]);
  });

  it("makes only the set's first positive outcome with no follow-up the clean one", () => {
    const inspection = defaultOutcomeSets.inspection_result;
    expect(["passed", "passed_with_comments", "failed"].map((c) => look(c, inspection))).toEqual(["a", "b", "d"]);
  });
});
