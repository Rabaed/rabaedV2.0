import type { RevisionChain } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { revisionPicker } from "./revision-picker-model.ts";

type Revision = RevisionChain["revisions"][number];

const stage = (key: string, category: Revision["stage"]["category"]): Revision["stage"] => ({ key, category, name: Object.fromEntries([["en", key], ["ar", key]]) as Revision["stage"]["name"] });
const closedAtC = stage("revise_resubmit", "closed_negative");
const original: Revision = {
  id: "00000000-0000-4000-8000-000000000000",
  documentNumber: "TWR-TMC-EL-MAR-280",
  revisionNo: 0,
  stage: closedAtC,
  submissionDate: "2026-07-01T09:00:00.000Z",
  closedAt: "2026-07-25T09:00:00.000Z",
  outcome: "C",
};
const rev1: Revision = {
  id: "00000000-0000-4000-8000-000000000001",
  documentNumber: "TWR-TMC-EL-MAR-280 Rev 1",
  revisionNo: 1,
  stage: closedAtC,
  submissionDate: "2026-08-01T09:00:00.000Z",
  closedAt: "2026-08-20T09:00:00.000Z",
  outcome: "C",
};
const rev2: Revision = {
  id: "00000000-0000-4000-8000-000000000002",
  documentNumber: "TWR-TMC-EL-MAR-280 Rev 2",
  revisionNo: 2,
  stage: stage("pending_approval", "in_progress"),
  submissionDate: "2026-09-01T09:00:00.000Z",
  closedAt: null,
  outcome: null,
};
const draftRev2: Revision = { ...rev2, documentNumber: null, stage: stage("draft", "draft"), submissionDate: null };

describe("the Revision picker (RP-1253)", () => {
  it("shows nothing when the viewer sees only the Original", () => {
    expect(revisionPicker([original], original.id)).toEqual({ kind: "none" });
  });

  it("is a plain Rev n label when the viewer sees only that Revision", () => {
    expect(revisionPicker([rev1], rev1.id)).toEqual({ kind: "label", revisionNo: 1 });
  });

  // RP-1300 (owner's decision 2026-11-13): a Draft Revision shows the Revision list too, linking each earlier one.
  it("lists the chain on a Draft Revision, the Draft open and Current, with no date and no banner", () => {
    const view = revisionPicker([original, rev1, draftRev2], draftRev2.id);
    expect(view).toMatchObject({ kind: "button", revisionNo: 2, past: false, banner: null });
    expect(view.kind === "button" && view.rows.map((r) => [r.id, r.open, r.current, r.date])).toEqual([
      [draftRev2.id, true, true, null],
      [rev1.id, false, false, { kind: "closed", at: rev1.closedAt }],
      [original.id, false, false, { kind: "closed", at: original.closedAt }],
    ]);
  });

  it("is a plain Rev n label on a Draft Revision the viewer sees alone", () => {
    expect(revisionPicker([draftRev2], draftRev2.id)).toEqual({ kind: "label", revisionNo: 2 });
  });

  it("lists the visible Revisions newest first, the Original last, the latest marked Current and dated by its Submission Date", () => {
    const view = revisionPicker([original, rev1, rev2], rev2.id);
    expect(view).toEqual({
      kind: "button",
      revisionNo: 2,
      past: false,
      banner: null,
      rows: [
        { id: rev2.id, revisionNo: 2, open: true, current: true, date: { kind: "submitted", at: rev2.submissionDate }, chip: { kind: "stage", stage: rev2.stage } },
        { id: rev1.id, revisionNo: 1, open: false, current: false, date: { kind: "closed", at: rev1.closedAt }, chip: { kind: "outcome", outcome: "C" } },
        { id: original.id, revisionNo: 0, open: false, current: false, date: { kind: "closed", at: original.closedAt }, chip: { kind: "outcome", outcome: "C" } },
      ],
    });
  });

  it("opens an earlier Revision read-only, past, with a banner naming the latest the viewer sees", () => {
    const view = revisionPicker([original, rev1, rev2], original.id);
    expect(view).toMatchObject({
      kind: "button",
      revisionNo: 0,
      past: true,
      banner: { outcome: "C", latest: { id: rev2.id, revisionNo: 2 } },
    });
    expect(view.kind === "button" && view.rows.map((r) => [r.revisionNo, r.open])).toEqual([[2, false], [1, false], [0, true]]);
  });

  it("names no later Revision the viewer can't see: Rev 1 is their latest, with no banner (RP-1253-1)", () => {
    // The chain read leaves Rev 2 out for this viewer; nothing here may bring it back.
    const view = revisionPicker([original, rev1], rev1.id);
    expect(view).toMatchObject({ kind: "button", revisionNo: 1, past: false, banner: null });
    expect(view.kind === "button" && view.rows.map((r) => r.revisionNo)).toEqual([1, 0]);
    expect(JSON.stringify(view)).not.toContain(rev2.id);
  });

  it("gives the whole chain's banner to a viewer who sees Rev 2 (RP-1253-2)", () => {
    const view = revisionPicker([original, rev1, rev2], rev1.id);
    expect(view).toMatchObject({ kind: "button", past: true, banner: { latest: { id: rev2.id, revisionNo: 2 } } });
  });

  it("dates a Draft latest with no line: it has no Submission Date", () => {
    const view = revisionPicker([original, rev1, draftRev2], rev1.id);
    expect(view.kind === "button" && view.rows[0]).toMatchObject({ revisionNo: 2, current: true, date: null, chip: { kind: "stage", stage: draftRev2.stage } });
  });

  it("shows nothing for an item missing from its own chain", () => {
    expect(revisionPicker([original, rev1], rev2.id)).toEqual({ kind: "none" });
  });
});
