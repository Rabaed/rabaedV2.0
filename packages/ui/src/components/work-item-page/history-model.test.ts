import type { WorkItemHistory } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import type { SubmittalTimelineOutcomes } from "../submittal-panel/timeline-model.ts";
import { workItemHistoryEntries } from "./history-model.ts";

type Event = WorkItemHistory["events"][number];

// A name in both languages, built as data (the package has no translations of its own).
const b = (en: string, ar: string = en) => Object.fromEntries([["en", en], ["ar", ar]]) as { en: string; ar: string };

const contractor = b("TMC Constructions", "تي إم سي للمقاولات");
const consultant = b("Design Consultants LLC", "ديزاين للاستشارات");
const hafiz = b("Hafiz Hamdan", "حافظ حمدان");
const ali = b("Ali Sonour", "علي سنور");
const shamsi = b("Mohammed Al Shamsi", "محمد الشامسي");
const engineer = b("Site Engineer", "مهندس موقع");

let seq = 0;
/** One history event as the read gives it; every field the read may leave null starts null. */
function event(over: Partial<Event> & Pick<Event, "type" | "audience">): Event {
  seq += 1;
  return {
    seq,
    at: `2026-10-${String(seq).padStart(2, "0")}T09:00:00.000Z`,
    by: { companyName: null, memberName: null, positions: [] },
    transition: null,
    fromStep: null,
    toStep: null,
    reason: null,
    remarks: null,
    documentNumber: null,
    outcome: null,
    internalNote: null,
    recommendedCode: null,
    changes: null,
    handover: null,
    answers: null,
    ...over,
  };
}

// The Material Submittal of the owner's design, as the Contractor's Site Engineer reads it after Code C.
const created = event({ type: "created", audience: "internal", by: { companyName: contractor, memberName: hafiz, positions: [engineer] } });
const returned = event({ type: "transition", audience: "internal", transition: b("Return"), reason: "Add the emergency duration.", by: { companyName: contractor, memberName: ali, positions: [] } });
const submitted = event({ type: "transition", audience: "shared", transition: b("Submit"), answers: { cover_note: "Datasheet and LM-79 attached." }, by: { companyName: contractor, memberName: ali, positions: [] } });
const coded = event({ type: "issue_code", audience: "shared", transition: b("Revise & Resubmit"), outcome: "C", remarks: "Show the circuit separation.", by: { companyName: consultant, memberName: shamsi, positions: [b("Lead Reviewer")] } });
const outcomes: SubmittalTimelineOutcomes = [
  { code: "A", polarity: "positive", actions: [] },
  { code: "C", polarity: "negative", actions: [] },
];

describe("the Work Item page's History (RP-1151, gap table rows 60–63)", () => {
  const entries = workItemHistoryEntries({ events: [created, returned, submitted, coded], viewerCompany: contractor, outcomes });

  it("lists every event the viewer reads, newest first, numbered from the oldest", () => {
    expect(entries.map((e) => [e.n, e.event.seq])).toEqual([
      [4, coded.seq],
      [3, submitted.seq],
      [2, returned.seq],
      [1, created.seq],
    ]);
  });

  it("marks the viewer's own internal events, and only those", () => {
    expect(entries.map((e) => e.internal)).toEqual([false, false, true, true]);
  });

  it("names the viewer's own people with their Positions", () => {
    const first = entries.find((e) => e.event.seq === created.seq)!;
    expect(first.person).toEqual(hafiz);
    expect(first.positions).toEqual([engineer]);
  });

  it("names another Company's Code by its signer, without the signer's Position (V14)", () => {
    const code = entries[0]!;
    expect(code.person).toEqual(shamsi);
    expect(code.positions).toEqual([]);
  });

  it("names another Company's Submit by the Company only, never its person (V14)", () => {
    const asConsultant = workItemHistoryEntries({ events: [submitted, coded], viewerCompany: consultant, outcomes });
    const submit = asConsultant.find((e) => e.event.seq === submitted.seq)!;
    expect(submit.person).toBeNull();
    expect(submit.positions).toEqual([]);
    expect(submit.event.by.companyName).toEqual(contractor);
  });

  it("keeps the text written with each move: the Cover Note, the Remarks, a Return's reason", () => {
    expect(entries.find((e) => e.event.seq === submitted.seq)!.texts).toEqual([{ kind: "coverNote", text: "Datasheet and LM-79 attached." }]);
    expect(entries[0]!.texts).toEqual([{ kind: "remarks", text: "Show the circuit separation." }]);
    expect(entries.find((e) => e.event.seq === returned.seq)!.texts).toEqual([{ kind: "reason", text: "Add the emergency duration." }]);
  });

  it("tones a Code by its place in the set and a move that goes back as a warning", () => {
    expect(entries[0]!.tone).toBe("bad");
    expect(entries.find((e) => e.event.seq === returned.seq)!.tone).toBe("warn");
    expect(entries.find((e) => e.event.seq === submitted.seq)!.tone).toBe("neutral");
  });

  it("names nobody it can't tell apart while the viewer's Company is unknown", () => {
    const unknown = workItemHistoryEntries({ events: [submitted], viewerCompany: null });
    expect(unknown[0]!.person).toBeNull();
  });
});
