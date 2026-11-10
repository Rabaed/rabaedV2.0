import { formSchema, type DimensionValues, type NewItemRoutePreview } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  afterSaveAnswers,
  canRaise,
  createSubmittalPanelLayout,
  draftStepKey,
  lockedDocumentSections,
  raisableTypesPath,
  requiredItems,
  resumableDraft,
  savedClock,
  typedSomething,
} from "./new-submittal-panel.ts";

// RP-1152: the create panel's logic, apart from React. MAR Form Version 7 is the worked example:
// its required fields are the gap table's row 25 (Subject, Trade, Approved supplier, Location,
// Manufacturer, Description, Datasheet).

const schema = formSchema.parse(JSON.parse(readFileSync(new URL("../../../admin/forms/MAR.json", import.meta.url), "utf8")));
const bi = (en: string) => ({ en, ar: en });

describe("who may raise from the List (decision 6)", () => {
  const covered = (trades: number): DimensionValues => ({ trade: Array.from({ length: trades }, (_, i) => ({ id: `t${i}`, code: `T${i}`, name: bi("T") })), location: [] }) as unknown as DimensionValues;
  const types = { types: [{ code: "MAR", name: bi("Material Approval Request") }] };

  it("needs a Submittals Type to raise and a Trade the Visibility covers", () => {
    expect(canRaise(types, covered(1))).toBe(true);
    expect(canRaise({ types: [] }, covered(1))).toBe(false);
    expect(canRaise(types, covered(0))).toBe(false);
    expect(canRaise(null, covered(1))).toBe(false);
    expect(canRaise(types, null)).toBe(false);
  });
});

describe("the required checklist (rows 25, 33)", () => {
  it("lists the Subject, then the Form's required fields in its order: 7 for the MAR", () => {
    const items = requiredItems({ schema, answers: {}, subject: "", subjectLabel: "Subject", filedFields: new Set(), locale: "en" });
    expect(items.map((i) => i.label)).toEqual(["Subject", "Trade", "Approved supplier", "Location", "Manufacturer", "Description", "Datasheet (PDF)"]);
    expect(items.every((i) => !i.done)).toBe(true);
  });

  it("ticks what is filled: a typed Subject, an answer, a Documents field with a file", () => {
    const items = requiredItems({ schema, answers: { trade: "t1", manufacturer: " " }, subject: "LED", subjectLabel: "Subject", filedFields: new Set(["datasheet"]), locale: "en" });
    expect(items.filter((i) => i.done).map((i) => i.key)).toEqual(["subject", "trade", "datasheet"]);
  });
});

describe("Documents before the first save (row 29)", () => {
  it("locks each Form Section that holds only Documents fields, a slot per field", () => {
    expect(lockedDocumentSections(schema, "en")).toEqual([
      {
        sectionKey: "documents",
        slots: [
          { key: "datasheet", label: "Datasheet (PDF)", icon: "file-text" },
          { key: "test_certificate", label: "Test certificate", icon: "file-text" },
          { key: "sample_photo", label: "Sample photo", icon: "photo" },
        ],
      },
    ]);
  });
});

describe("the route preview's own position", () => {
  it("is the Draft Step: the Step at the Draft Stage", () => {
    const preview = {
      definition: { steps: [{ key: "review", stage: "s2" }, { key: "prepare", stage: "s1" }], transitions: [] },
      stages: [
        { key: "s1", name: bi("Draft"), category: "draft" },
        { key: "s2", name: bi("Under review"), category: "in_progress" },
      ],
      draftsVisibleTo: "company",
    } as unknown as NewItemRoutePreview;
    expect(draftStepKey(preview)).toBe("prepare");
  });
});

describe("after a save (row 13, the hooks for RP-1221 and RP-1222)", () => {
  const answers = { trade: "t1", location: "l1", description: "x" };
  it("stays: the Form keeps every answer", () => {
    expect(afterSaveAnswers(answers, { mode: "stay" })).toEqual(answers);
  });
  it("clears: the Form empties but keeps the listed fields", () => {
    expect(afterSaveAnswers(answers, { mode: "clear", keep: ["trade", "location"] })).toEqual({ trade: "t1", location: "l1" });
    expect(afterSaveAnswers(answers, { mode: "clear" })).toEqual({});
  });
});

describe("Cancel before the first save (row 37)", () => {
  it("asks only when something was typed", () => {
    expect(typedSomething({ subject: "", answers: { trade: "t1" }, start: { trade: "t1" } })).toBe(false);
    expect(typedSomething({ subject: " ", answers: {}, start: {} })).toBe(false);
    expect(typedSomething({ subject: "LED", answers: {}, start: {} })).toBe(true);
    expect(typedSomething({ subject: "", answers: { trade: "t2" }, start: { trade: "t1" } })).toBe(true);
    expect(typedSomething({ subject: "", answers: { model: "" }, start: {} })).toBe(false);
  });
});

describe("the layout by screen width (decision 1)", () => {
  it("is a page on a phone, the full width on a tablet, a slide-over on a desktop", () => {
    expect(createSubmittalPanelLayout({ phone: true, tablet: true })).toBe("page");
    expect(createSubmittalPanelLayout({ phone: false, tablet: true })).toBe("tablet-full");
    expect(createSubmittalPanelLayout({ phone: false, tablet: false })).toBe("slide-over");
  });
  // The widths themselves are the app's PHONE and TABLET (@rabaed/ui, widths.test.ts, RP-1271).
});

describe("the raisable Types' read", () => {
  it("asks for the Submittals by default, and names any other Module", () => {
    expect(raisableTypesPath("p 1", "submittals")).toBe("/v1/projects/p%201/raisable-types");
    expect(raisableTypesPath("p1", "inspections")).toBe("/v1/projects/p1/raisable-types?module=inspections");
  });
});

// Row 38: a reload with `&draft=<id>` reopens the saved Draft, but only one the viewer still holds
// as a first Draft of a Type they may raise here. Anything else is a fresh create panel.
describe("the saved Draft a reload reopens (row 38)", () => {
  const draft = {
    projectId: "p1",
    type: { code: "MAR" },
    documentNumber: null,
    revisionNo: 0,
    stage: { category: "draft" as const },
    actions: { saveAnswers: true },
  };
  const types = [{ code: "MAR" }, { code: "SAR" }];

  it("reopens the viewer's own first Draft", () => {
    expect(resumableDraft(draft, { projectId: "p1", types })).toBe(true);
  });

  it("falls back to a fresh panel for anything else", () => {
    expect(resumableDraft(null, { projectId: "p1", types })).toBe(false);
    expect(resumableDraft({ ...draft, projectId: "p2" }, { projectId: "p1", types })).toBe(false);
    expect(resumableDraft({ ...draft, type: { code: "DAR" } }, { projectId: "p1", types })).toBe(false);
    expect(resumableDraft({ ...draft, stage: { category: "in_progress" as const } }, { projectId: "p1", types })).toBe(false);
    expect(resumableDraft({ ...draft, documentNumber: "P1-MAR-0001" }, { projectId: "p1", types })).toBe(false);
    expect(resumableDraft({ ...draft, revisionNo: 1 }, { projectId: "p1", types })).toBe(false);
    // Another Member's Draft of the same Company: seen, but not theirs to edit.
    expect(resumableDraft({ ...draft, actions: { saveAnswers: false } }, { projectId: "p1", types })).toBe(false);
  });
});

describe("Saved hh:mm (row 38)", () => {
  it("is Saudi time, 24-hour, in Latin digits in both languages", () => {
    expect(savedClock("2026-11-02T07:42:00Z", "en")).toBe("10:42");
    expect(savedClock("2026-11-02T13:05:00Z", "ar")).toBe("16:05");
  });
});
