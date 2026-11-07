import type { RevisionChain, WorkItemOutcome } from "@rabaed/domain";

// The Revision picker (RP-1253), worked out apart from React. It reads only the chain read
// (`GET /v1/work-items/:id/revisions`): the Revisions the viewer may see, each by V1 on its own
// (visibility.md, the Revisions channel). So "Current", "Replaced by" and "Go to" name the latest
// Revision the viewer sees, never a later one they don't: a hidden Revision isn't here to name.

type Revision = RevisionChain["revisions"][number];

export type RevisionPickerRow = {
  id: string;
  revisionNo: number;
  /** The one open in the panel or on the page: checked. */
  open: boolean;
  /** The latest the viewer sees: tagged "Current". */
  current: boolean;
  /** "Submitted <date>" on the latest, "Returned <date>" (its close) on an earlier one; none without one. Event dates only. */
  date: { kind: "submitted" | "returned"; at: string } | null;
  /** The latest's Stage as the viewer reads it; an earlier one's Outcome (Code C), never "Rejected". */
  chip: { kind: "stage"; stage: Revision["stage"] } | { kind: "outcome"; outcome: WorkItemOutcome };
};

export type RevisionPickerView =
  /** Only the Original seen, or the item isn't in its own chain: nothing. */
  | { kind: "none" }
  /** A Draft Revision, or the only Revision seen: a plain "Rev n", not a button. */
  | { kind: "label"; revisionNo: number }
  | {
      kind: "button";
      /** The open one's number: "Rev n", or the Original at 0. */
      revisionNo: number;
      /** An earlier Revision is open: the button turns amber, the panel is read only. */
      past: boolean;
      latest: { id: string; revisionNo: number };
      /** Newest first, the Original last. */
      rows: RevisionPickerRow[];
      /** "You are viewing Rev 1 · Code C. Replaced by Rev 2." and "Go to Rev 2"; null on the latest. */
      banner: { revisionNo: number; outcome: WorkItemOutcome | null; latest: { id: string; revisionNo: number } } | null;
    };

/** The picker for the Revision `openId`, from the chain read (in order, the Original first). */
export function revisionPicker(revisions: readonly Revision[], openId: string): RevisionPickerView {
  const open = revisions.find((r) => r.id === openId);
  if (!open) return { kind: "none" };
  if (revisions.length < 2 || open.stage.category === "draft") return open.revisionNo > 0 ? { kind: "label", revisionNo: open.revisionNo } : { kind: "none" };
  const newest = [...revisions].sort((a, b) => b.revisionNo - a.revisionNo);
  const top = newest[0]!;
  const latest = { id: top.id, revisionNo: top.revisionNo };
  const past = open.id !== top.id;
  const rows = newest.map((r): RevisionPickerRow => {
    const current = r.id === top.id;
    const at = current ? r.submissionDate : r.closedAt;
    return {
      id: r.id,
      revisionNo: r.revisionNo,
      open: r.id === open.id,
      current,
      date: at === null ? null : { kind: current ? "submitted" : "returned", at },
      chip: !current && r.outcome !== null ? { kind: "outcome", outcome: r.outcome } : { kind: "stage", stage: r.stage },
    };
  });
  return {
    kind: "button",
    revisionNo: open.revisionNo,
    past,
    latest,
    rows,
    banner: past ? { revisionNo: open.revisionNo, outcome: open.outcome, latest } : null,
  };
}
