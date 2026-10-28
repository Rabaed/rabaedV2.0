import type { TransitionFact } from "@rabaed/db";
import { describe, expect, it } from "vitest";
import { goldenFacts } from "./golden-fixtures.ts";
import { recordDataOf, recordPath } from "./record-data.ts";

// The path to the outcome the Record Data names (V7; workflow-engine.md §7).

const t = (n: number, kind: string, from: string, to: string): TransitionFact => ({
  kind,
  fromStepId: from,
  toStepId: to,
  label: { en: `T${n}`, ar: `T${n}` },
  at: `2026-10-17T0${n}:00:00.000Z`,
  memberName: { en: "M", ar: "M" },
  positions: [],
  companyName: { en: "C", ar: "C" },
  contentSha256: null,
  outcomeMode: null,
  remarks: null,
  participantId: "p",
  roleName: { en: "Contractor", ar: "مقاول" },
  answers: null,
  actionForm: null,
  signature: null,
});
const labels = (path: TransitionFact[]) => path.map((p) => p.label.en);

describe("recordPath", () => {
  it("keeps every Transition of a straight route", () => {
    expect(labels(recordPath([t(1, "send", "draft", "review"), t(2, "submit", "review", "consultant"), t(3, "close", "consultant", "approved")]))).toEqual([
      "T1",
      "T2",
      "T3",
    ]);
  });

  it("leaves out a Return and the send it gave back: Prepared is the last send out of the Draft", () => {
    const path = recordPath([
      t(1, "send", "draft", "review"),
      t(2, "return", "review", "draft"),
      t(3, "send", "draft", "review"),
      t(4, "submit", "review", "consultant"),
      t(5, "close", "consultant", "approved"),
    ]);
    expect(labels(path)).toEqual(["T3", "T4", "T5"]);
  });

  // RP-1053: the Rabaed Default MAR Returns to the Contractor Engineer's Step, never the Draft,
  // and the engineer sends it again from there; the Returned send is still off the record.
  it("leaves out a send that was Returned to another Step: Prepared is the send again (RP-1053)", () => {
    const path = recordPath([
      t(1, "send", "draft", "internal_review"),
      t(2, "return", "internal_review", "contractor_engineer"),
      t(3, "send", "contractor_engineer", "internal_review"),
      t(4, "submit", "internal_review", "consultant_engineer"),
      t(5, "send", "consultant_engineer", "consultant_manager"),
      t(6, "close", "consultant_manager", "approved"),
    ]);
    expect(labels(path)).toEqual(["T3", "T4", "T5", "T6"]);
  });

  it("leaves out each Returned send when an item is Returned twice", () => {
    const path = recordPath([
      t(1, "send", "draft", "internal_review"),
      t(2, "return", "internal_review", "contractor_engineer"),
      t(3, "send", "contractor_engineer", "internal_review"),
      t(4, "return", "internal_review", "contractor_engineer"),
      t(5, "send", "contractor_engineer", "internal_review"),
      t(6, "submit", "internal_review", "consultant_engineer"),
    ]);
    expect(labels(path)).toEqual(["T5", "T6"]);
  });

  // OBS and SNG take Resume (On Hold → In Progress) as a `return`: it gives nothing back, so the hold stays on the record.
  it("keeps the move a Resume follows, which brought the item On Hold", () => {
    const path = recordPath([
      t(1, "send", "draft", "open"),
      t(2, "send", "open", "on_hold"),
      t(3, "return", "on_hold", "in_progress"),
      t(4, "send", "in_progress", "verify"),
      t(5, "close", "verify", "closed"),
    ]);
    expect(labels(path)).toEqual(["T1", "T2", "T4", "T5"]);
  });

  it("never carries a Return, even when the item closes right after it", () => {
    const path = recordPath([t(1, "send", "draft", "review"), t(2, "return", "review", "draft"), t(3, "cancel", "draft", "cancelled")]);
    expect(path.map((p) => p.kind)).not.toContain("return");
    expect(labels(path)).toEqual(["T3"]);
    // A Return into a Step the item never left before still never shows.
    expect(labels(recordPath([t(1, "send", "a", "b"), t(2, "return", "b", "c"), t(3, "close", "c", "done")]))).toEqual(["T1", "T3"]);
  });

  it("leaves out a Send Back, such as a Code the Owner sent back, and the Code it gave back", () => {
    const path = recordPath([
      t(1, "submit", "draft", "consultant"),
      t(2, "send", "consultant", "owner"),
      t(3, "send_back", "owner", "consultant"),
      t(4, "send", "consultant", "owner"),
      t(5, "close", "owner", "approved"),
    ]);
    expect(labels(path)).toEqual(["T1", "T4", "T5"]);
  });
});

describe("the reply on page 1", () => {
  const verification = { code: "7K2M-9QXD", link: "https://rabaed.test/verify/x" };
  const base = goldenFacts("A", "en");
  const remarksOf = (facts: typeof base) => recordDataOf(facts, verification).reply?.text ?? null;

  it("is the Remarks of the Code that is the outcome", () => {
    expect(remarksOf(base)).toContain("Approved as submitted.");
  });

  it("is none for a Cancel, whatever Code's Remarks the events held", () => {
    expect(remarksOf({ ...base, outcome: "cancelled" })).toBeNull();
  });

  it("is never the Remarks of a Code off the path, such as one the Owner sent back", () => {
    const stale = { ...base.transitions[3]!, fromStepId: "owner", kind: "send", remarks: "A Code the Owner sent back" };
    const sentBack = { ...base.transitions[3]!, fromStepId: "owner", toStepId: "consultant", kind: "send_back", outcomeMode: null, remarks: null };
    const cancel = { ...base.transitions[3]!, fromStepId: "consultant", toStepId: "cancelled", kind: "cancel", outcomeMode: null, remarks: null };
    const facts = { ...base, outcome: "cancelled", transitions: [...base.transitions.slice(0, 2), { ...stale, fromStepId: "consultant" }, sentBack, cancel] };
    expect(recordDataOf(facts, verification).reply).toBeNull();
    // Even if the outcome were a Code, the last entry on the path is what counts.
    expect(remarksOf({ ...base, transitions: [{ ...stale, fromStepId: "consultant" }, sentBack, { ...cancel, kind: "close", outcomeMode: "issue_code", remarks: "The Code that closed it" }] })).toBe("The Code that closed it");
  });

  it("is none when the closing Transition gave no Code", () => {
    expect(remarksOf({ ...base, transitions: base.transitions.map((t, i) => (i === 3 ? { ...t, outcomeMode: null } : t)) })).toBeNull();
  });
});
