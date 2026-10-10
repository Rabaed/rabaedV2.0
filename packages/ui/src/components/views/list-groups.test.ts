import type { WorkItemRow } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { groupRows } from "./list-groups.ts";

// Story data only.
const b = (en: string, ar: string) => Object.fromEntries([["en", en], ["ar", ar]]) as { en: string; ar: string };
const stages = [
  { key: "draft", name: b("Draft", "مسودة"), category: "draft" as const, count: 0 },
  { key: "pending_approval", name: b("Pending Approval", "بانتظار الاعتماد"), category: "in_progress" as const, count: 0 },
  { key: "approved", name: b("Approved", "معتمد"), category: "closed_positive" as const, count: 0 },
];
const civil = { id: "00000000-0000-4000-8000-0000000000c1", code: "CV", name: b("Civil Works", "أعمال مدنية") };
const electrical = { id: "00000000-0000-4000-8000-0000000000e1", code: "EL", name: b("Electrical Works", "أعمال كهربائية") };
const zoneA = { id: "00000000-0000-4000-8000-0000000000a1", code: "ZA", name: b("Zone A", "المنطقة A"), parentId: null, depth: 1, levelName: null };
const floor = { id: "00000000-0000-4000-8000-0000000000a2", code: "ZAF1", name: b("Floor 1", "الطابق 1"), parentId: zoneA.id, depth: 2, levelName: null };
const row = (n: number, rest: Partial<WorkItemRow>): WorkItemRow => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  projectId: "00000000-0000-4000-8000-000000000100",
  type: { code: "MAR", name: b("Material Submittal", "اعتماد مواد") },
  title: `Item ${n}`,
  documentNumber: `TWR-MAR-000${n}`,
  revisionNo: 0,
  stage: stages[1]!,
  trade: electrical,
  location: null,
  stepEnteredAt: null,
  stepAgeWeeks: null,
  outcome: null,
  with: null,
  submissionDate: null,
  creationDate: null,
  ...rest,
});
const rows = [
  row(1, { stage: stages[2]!, outcome: "A", trade: civil }),
  row(2, { location: floor }),
  row(3, { stage: stages[0]!, trade: civil }),
  row(4, { stage: stages[2]!, outcome: "B" }),
];
const filters = {
  stages,
  trades: [civil, electrical],
  locations: [zoneA, floor],
  outcomes: [
    { type: "MAR", code: "A", name: b("Approved", "معتمد"), closing: true, polarity: "positive" as const, actions: [] },
    { type: "MAR", code: "B", name: b("Approved as noted", "معتمد مع ملاحظات"), closing: true, polarity: "positive" as const, actions: [] },
  ],
};
const labels = { code: (c: string) => `Code ${c}`, cancelled: "Cancelled", unclaimed: "unclaimed" };
const shape = (by: Parameters<typeof groupRows>[1]) =>
  groupRows(rows, by, filters, "en", labels).map((g) => [g.label, g.rows.map((r) => r.title)]);

describe("grouping the page's rows (RP-409)", () => {
  it("by Status, in the Project's order of Stages", () => {
    expect(shape("stage")).toEqual([
      ["Draft", ["Item 3"]],
      ["Pending Approval", ["Item 2"]],
      ["Approved", ["Item 1", "Item 4"]],
    ]);
  });

  it("by Discipline, in the Project's order of Trades", () => {
    expect(shape("trade")).toEqual([
      ["Civil Works (CV)", ["Item 1", "Item 3"]],
      ["Electrical Works (EL)", ["Item 2", "Item 4"]],
    ]);
  });

  it("by Zone, the top of each item's place; items with none last", () => {
    expect(shape("locationLevel1")).toEqual([
      ["Zone A", ["Item 2"]],
      [null, ["Item 1", "Item 3", "Item 4"]],
    ]);
  });

  it("by Code, in the Type's order of outcomes; open items last", () => {
    expect(shape("outcome")).toEqual([
      ["Code A", ["Item 1"]],
      ["Code B", ["Item 4"]],
      [null, ["Item 2", "Item 3"]],
    ]);
  });
});
