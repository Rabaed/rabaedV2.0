import type { WorkItemHistory } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { transitionCodes, workItemCodeResult } from "./page-model.ts";

type Event = WorkItemHistory["events"][number];
const b = (en: string, ar: string = en) => Object.fromEntries([["en", en], ["ar", ar]]) as { en: string; ar: string };

const consultant = b("Design Consultants LLC");
const shamsi = b("Mohammed Al Shamsi");

let seq = 0;
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

describe("the result card after a Code (RP-1151, gap table row 23)", () => {
  it("is the Code the item closed with: its code, when, the Remarks and who signed it", () => {
    const submit = event({ type: "transition", audience: "shared", transition: b("Submit") });
    const code = event({ type: "issue_code", audience: "shared", outcome: "C", remarks: "Show the circuit separation.", by: { companyName: consultant, memberName: shamsi, positions: [b("Lead Reviewer")] } });
    expect(workItemCodeResult([submit, code], "C")).toEqual({ code: "C", at: code.at, remarks: "Show the circuit separation.", signer: shamsi, company: consultant });
  });

  it("has no Remarks when none were written", () => {
    const code = event({ type: "issue_code", audience: "shared", outcome: "A", by: { companyName: consultant, memberName: shamsi, positions: [] } });
    expect(workItemCodeResult([code], "A")?.remarks).toBeNull();
  });

  it("is never a Recommended Code, which stays inside its Participant (V5)", () => {
    const recommended = event({ type: "recommend_code", audience: "internal", recommendedCode: "B", by: { companyName: consultant, memberName: shamsi, positions: [] } });
    expect(workItemCodeResult([recommended], null)).toBeNull();
  });

  it("is none while the item is open, and none for a Cancel", () => {
    const code = event({ type: "issue_code", audience: "shared", outcome: "C" });
    expect(workItemCodeResult([code], null)).toBeNull();
    expect(workItemCodeResult([event({ type: "cancelled", audience: "shared" })], "cancelled")).toBeNull();
  });

  it("is the latest Code when the history holds more than one", () => {
    const first = event({ type: "issue_code", audience: "shared", outcome: "B" });
    const last = event({ type: "issue_code", audience: "shared", outcome: "C" });
    expect(workItemCodeResult([first, last], "C")?.at).toBe(last.at);
  });
});

describe("the code on a Transition's button (RP-1151, gap table row 27)", () => {
  const definition = {
    transitions: [
      { key: "approve_a", kind: "close", outcome: "A" },
      { key: "revise_c", kind: "close", outcome: "C" },
      { key: "return", kind: "return", outcome: null },
    ],
  };

  it("is the outcome its Workflow's close Transition sets, by the offered Transition's key", () => {
    const codes = transitionCodes([{ key: "approve_a" }, { key: "revise_c" }, { key: "return" }], definition);
    expect(codes).toEqual({ approve_a: "A", revise_c: "C" });
  });

  it("is none for a Transition the definition doesn't know, or with no definition read", () => {
    expect(transitionCodes([{ key: "submit" }], definition)).toEqual({});
    expect(transitionCodes([{ key: "approve_a" }], null)).toEqual({});
  });
});
