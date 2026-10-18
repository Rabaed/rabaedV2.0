import type { TransitionFact } from "@rabaed/db";
import { describe, expect, it } from "vitest";
import { recordPath } from "./record-data.ts";

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
