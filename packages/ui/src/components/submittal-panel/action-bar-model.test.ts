import type { WorkItemDetail } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { submittalPanelBar } from "./action-bar-model.ts";

// RP-1237 (gap table v3, rows 22–27 and 48–51): what the Submittal Panel's action bar offers, from
// exactly what the engine offers the viewer. Download PDF is always there and is not part of this.

type Actions = WorkItemDetail["actions"];
type Transition = Actions["transitions"][number];
type HeldBy = WorkItemDetail["heldBy"];

const none: Actions = {
  pickUp: false,
  returnToPool: false,
  saveAnswers: false,
  createRevision: false,
  createReplacement: false,
  discardRevision: false,
  duplicate: false,
  discardDraft: false,
  editPaperRef: false,
  signatureRequired: false,
  stampRequired: false,
  transitions: [],
  recommendedCode: null,
} as unknown as Actions;

/** A name in both languages, as the item read gives it (story data, not the UI's own words). */
const bi = (en: string, ar: string) => Object.fromEntries([["en", en], ["ar", ar]]) as { en: string; ar: string };

const transition = (key: string, kind: Transition["kind"]): Transition =>
  ({ key, kind, label: bi(key, key), actionForm: null }) as Transition;

const consultant = bi("Consultant Co", "الاستشاري");
const ahmed = bi("Ahmed bin Said", "أحمد بن سعيد");
const heldBy = (held: Partial<NonNullable<HeldBy>>): HeldBy => ({ companyName: consultant, memberName: null, pool: null, ...held }) as HeldBy;

describe("the Submittal Panel's action bar", () => {
  it("puts the code Transitions in the Review Code menu, and a Send Back below its divider", () => {
    const [a, b, sendBack] = [transition("approve", "close"), transition("approve_noted", "close"), transition("send_back", "send_back")];
    const bar = submittalPanelBar({
      actions: { ...none, returnToPool: true, transitions: [a, b, sendBack] },
      codes: { approve: "A", approve_noted: "B" },
      heldBy: heldBy({ memberName: ahmed }),
      stepAgeWeeks: 1,
    });
    expect(bar.menu).toEqual({ codes: [a, b], others: [sendBack] });
    expect(bar.buttons).toEqual([]);
    expect(bar.returnToPool).toBe(true);
    expect(bar.chip).toBeNull();
  });

  it("shows Transitions that issue no code as buttons, with no menu", () => {
    const [back, submit] = [transition("return", "return"), transition("sign_submit", "send")];
    const bar = submittalPanelBar({ actions: { ...none, transitions: [back, submit] }, codes: {}, heldBy: heldBy({ memberName: ahmed }), stepAgeWeeks: 1 });
    expect(bar.menu).toBeNull();
    expect(bar.buttons).toEqual([back, submit]);
  });

  it("offers Pick up with the pool's chip while the item waits in the viewer's Step Pool, and no code menu", () => {
    const bar = submittalPanelBar({
      actions: { ...none, pickUp: true },
      codes: {},
      heldBy: heldBy({ pool: { names: [ahmed, bi("Sara", "سارة"), bi("Omar", "عمر")] } }),
      stepAgeWeeks: 2,
    });
    expect(bar.pickUp).toBe(true);
    expect(bar.chip).toEqual({ kind: "pool", count: 3 });
    expect(bar.menu).toBeNull();
  });

  it("names who picked it up, with its Step Age, when someone of the viewer's own Company holds it and nothing is offered", () => {
    const bar = submittalPanelBar({ actions: none, codes: {}, heldBy: heldBy({ memberName: ahmed }), stepAgeWeeks: 1 });
    expect(bar.chip).toEqual({ kind: "pickedUp", name: ahmed, weeks: 1 });
  });

  it("says View only when another Company holds it (by its name only, so no one to name)", () => {
    const bar = submittalPanelBar({ actions: none, codes: {}, heldBy: heldBy({}), stepAgeWeeks: 3 });
    expect(bar.chip).toEqual({ kind: "viewOnly" });
  });

  it("says View only on a closed item that offers nothing", () => {
    expect(submittalPanelBar({ actions: none, codes: {}, heldBy: null, stepAgeWeeks: null }).chip).toEqual({ kind: "viewOnly" });
  });

  it("offers Edit to the Form's holder, and Discard Revision beside it on a Draft Revision", () => {
    const bar = submittalPanelBar({ actions: { ...none, saveAnswers: true, discardRevision: true }, codes: {}, heldBy: heldBy({ memberName: ahmed }), stepAgeWeeks: null });
    expect(bar.edit).toBe(true);
    expect(bar.discardRevision).toBe(true);
    expect(bar.chip).toBeNull();
  });

  it("offers Create Revision or a replacement on a closed item when the engine does, with no View only", () => {
    const revision = submittalPanelBar({ actions: { ...none, createRevision: true }, codes: {}, heldBy: null, stepAgeWeeks: null });
    expect(revision.createRevision).toBe(true);
    expect(revision.chip).toBeNull();
    const replacement = submittalPanelBar({ actions: { ...none, createReplacement: true }, codes: {}, heldBy: null, stepAgeWeeks: null });
    expect(replacement.createReplacement).toBe(true);
    expect(replacement.chip).toBeNull();
  });

  // RP-1303: Duplicate in the panel too, by the same flag as the List row's ⋯ menu (the API works it out:
  // only the viewer's own Company's work, RP-409). It copies the item and moves nothing, so "View only" stays.
  it("offers Duplicate exactly when the item read does, and keeps View only beside it", () => {
    const closed = submittalPanelBar({ actions: { ...none, duplicate: true }, codes: {}, heldBy: null, stepAgeWeeks: null });
    expect(closed.duplicate).toBe(true);
    expect(closed.chip).toEqual({ kind: "viewOnly" });
    expect(submittalPanelBar({ actions: none, codes: {}, heldBy: null, stepAgeWeeks: null }).duplicate).toBe(false);
    const reviewing = submittalPanelBar({ actions: { ...none, duplicate: true, transitions: [transition("approve", "close")] }, codes: { approve: "A" }, heldBy: heldBy({ memberName: ahmed }), stepAgeWeeks: 1 });
    expect(reviewing.duplicate).toBe(true);
  });

  it("offers nothing on an earlier Revision, whatever the engine offers: 'Rev 1 · read only' and Download PDF (RP-1253)", () => {
    const everything: Actions = {
      ...none,
      pickUp: true,
      returnToPool: true,
      saveAnswers: true,
      createRevision: true,
      createReplacement: true,
      discardRevision: true,
      duplicate: true,
      transitions: [transition("approve", "close"), transition("submit", "submit")],
    };
    const bar = submittalPanelBar({ actions: everything, codes: { approve: "A" }, heldBy: heldBy({ pool: { names: [ahmed] } }), stepAgeWeeks: 1, pastRevision: 1 });
    expect(bar).toEqual({
      edit: false,
      discardRevision: false,
      createRevision: false,
      createReplacement: false,
      duplicate: false,
      buttons: [],
      menu: null,
      pickUp: false,
      returnToPool: false,
      chip: { kind: "pastRevision", revisionNo: 1 },
    });
    expect(submittalPanelBar({ actions: none, codes: {}, heldBy: null, stepAgeWeeks: null, pastRevision: 0 }).chip).toEqual({ kind: "pastRevision", revisionNo: 0 });
  });
});
