import type { ChecklistCopy, ChecklistTemplateItem, FormSchema, ReplyChecklistRead, WorkItemActions, WorkItemHistory } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { changedItems, codeRemarks, coverNote, inspectionActions, inspectionTally, itemsShown, recommendedCodeSent, requestedForText, sharedChecklists, snagsToRaise } from "./inspection.ts";

// The WIR screens' own reading of the Consultant Engineer's checklist (RP-655): what the summary
// bar, the tiles, the filter chips, the Send to Manager sheet and the code pop-up show.

const text = (en: string) => ({ en, ar: en });
const item = (key: string, extra: Partial<ChecklistTemplateItem> = {}): ChecklistTemplateItem => ({
  key,
  text: text(key),
  answers: "pass_fail_na",
  comment: "optional",
  photo: "off",
  on_negative: "create_snag",
  ...extra,
});

/** Five checks; the last answered Yes / No / N/A. */
const items = [item("supports"), item("earthing"), item("clearance"), item("labels"), item("cubes", { answers: "yes_no_na", on_negative: "none" })];

describe("the checklist's tally", () => {
  it("counts Pass and Yes as passed, Fail and No as failed, N/A apart, and how many of all are answered", () => {
    const tally = inspectionTally(items, {
      supports: { answer: "pass" },
      earthing: { answer: "fail", comment: "Jumpers missing" },
      clearance: { answer: "na" },
      cubes: { answer: "no" },
    });
    expect(tally).toEqual({ passed: 1, failed: 2, na: 1, answered: 4, total: 5 });
  });

  it("an item with only a comment, or an answer its set doesn't offer, is not answered", () => {
    expect(inspectionTally(items, { supports: { comment: "Later" }, cubes: { answer: "pass" } })).toEqual({ passed: 0, failed: 0, na: 0, answered: 0, total: 5 });
  });
});

describe("the Snags the code will raise", () => {
  it("each failed item still ticked, numbered as on the checklist; an unticked one and one whose template raises none are counted apart or left out", () => {
    const raised = snagsToRaise(items, {
      supports: { answer: "fail", comment: "Spacing 1.8 m" },
      earthing: { answer: "fail", snag: false },
      clearance: { answer: "pass" },
      labels: { answer: "fail" },
      cubes: { answer: "no" },
    });
    expect(raised).toEqual({
      ticked: [
        { key: "supports", number: 1, text: text("supports") },
        { key: "labels", number: 4, text: text("labels") },
      ],
      unticked: 1,
    });
  });

  it("none when nothing failed", () => {
    expect(snagsToRaise(items, { supports: { answer: "pass" } })).toEqual({ ticked: [], unticked: 0 });
  });
});

describe("the WIR's actions, exactly as the API offers them", () => {
  type Offered = WorkItemActions["transitions"][number];
  const offered = (key: string, kind: Offered["kind"], extra: Partial<Offered> = {}): Offered => ({ key, label: text(key), kind, actionForm: null, ...extra });
  const checklist: ReplyChecklistRead = {
    fieldKey: "inspection_checklist",
    copyOf: "checklist_template",
    label: text("Checklist"),
    name: text("Cable trays"),
    items,
    required: true,
    answers: { earthing: { answer: "fail" } },
    canChange: false,
  };

  it("the Manager's: the codes that take the checklist go to the code pop-up, the proposed one first picked; Return to Engineer stays a button", () => {
    const transitions = [
      offered("return_to_engineer", "return"),
      offered("approve_a", "close", { checklists: [checklist] }),
      offered("approve_b", "close", { checklists: [checklist] }),
      offered("revise_c", "close", { checklists: [checklist], proposed: true }),
      offered("reject_d", "close", { checklists: [checklist] }),
    ];
    const split = inspectionActions(transitions);
    expect(split.codes.map((t) => t.key)).toEqual(["approve_a", "approve_b", "revise_c", "reject_d"]);
    expect(split.proposed).toBe("revise_c");
    expect(split.send).toBeNull();
    expect(split.others.map((t) => t.key)).toEqual(["return_to_engineer"]);
  });

  it("the Engineer's: the move that Recommends a Code is the summary bar's Send to Manager", () => {
    const send = offered("send_to_manager", "send", { recommendCode: [{ code: "A", name: text("Approved") }] });
    const split = inspectionActions([send]);
    expect(split.send).toBe(send);
    expect(split.codes).toEqual([]);
    expect(split.others).toEqual([]);
  });

  it("anyone else's: every offered Transition stays a button, and no code pop-up without checklists", () => {
    const split = inspectionActions([offered("send_for_review", "send"), offered("cancel", "cancel"), offered("approve_a", "close")]);
    expect(split.others.map((t) => t.key)).toEqual(["send_for_review", "cancel", "approve_a"]);
    expect(split.codes).toEqual([]);
    expect(split.proposed).toBeNull();
  });
});

describe("what the WIR page reads from its history", () => {
  type Event = WorkItemHistory["events"][number];
  let seq = 0;
  const event = (type: Event["type"], extra: Partial<Event> = {}): Event => ({
    seq: ++seq,
    type,
    at: "2026-10-22T11:10:00.000Z",
    audience: "shared",
    by: { companyName: text("Design Consultants LLC"), memberName: text("Mohammed Al Shamsi") },
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
    ...extra,
  });
  const codeForm: FormSchema = {
    sections: [
      {
        key: "code",
        title: text("Code"),
        fields: [
          { key: "inspection_checklist", type: "copied_checklist", label: text("Checklist"), required: true, copyOf: "checklist_template" },
          { key: "remarks", type: "textarea", label: text("Remarks"), required: true },
        ],
      },
    ],
  };
  const copy: ChecklistCopy = {
    fieldKey: "checklist_template",
    templateId: "6f9d0b5e-1c1a-4c55-9a39-0d5c8f3a1b01",
    versionId: "6f9d0b5e-1c1a-4c55-9a39-0d5c8f3a1b02",
    versionNo: 2,
    name: text("Cable trays"),
    tradeId: "6f9d0b5e-1c1a-4c55-9a39-0d5c8f3a1b03",
    items,
  };
  const answered = { supports: { answer: "pass" }, earthing: { answer: "fail", comment: "Jumpers missing" } };
  const history: Event[] = [
    event("transition", { transition: text("Submit"), by: { companyName: text("TMC Constructions"), memberName: null }, answers: { cover_note: "Ready from 09:00" } }),
    event("recommend_code", { audience: "internal", recommendedCode: "C" }),
    event("issue_code", {
      at: "2026-10-22T11:10:00.000Z",
      transition: text("Revise & Resubmit · C"),
      outcome: "C",
      remarks: "Move the tray",
      answers: { inspection_checklist: answered, remarks: "Move the tray" },
      answersForm: codeForm,
    }),
  ];

  it("the Cover Note: the last Submit's, with who wrote it", () => {
    expect(coverNote(history)).toEqual({ text: "Ready from 09:00", by: { companyName: text("TMC Constructions"), memberName: null }, at: "2026-10-22T11:10:00.000Z" });
    expect(coverNote(history.slice(1))).toBeNull();
  });

  it("the code's reply: its Remarks, who issued it and when", () => {
    expect(codeRemarks(history)).toEqual({ text: "Move the tray", by: { companyName: text("Design Consultants LLC"), memberName: text("Mohammed Al Shamsi") }, at: "2026-10-22T11:10:00.000Z" });
    expect(codeRemarks(history.slice(0, 2))).toBeNull();
  });

  it("the Engineer's Recommended Code, internal to the Consultant: the last one, who sent it and when, and the Internal Note sent with it", () => {
    const sent = { companyName: text("Design Consultants LLC"), memberName: text("Ahmed bin Said") };
    const events = [
      event("transition", { transition: text("Send to Manager"), at: "2026-10-22T08:05:00.000Z", by: sent }),
      event("internal_note", { audience: "internal", transition: text("Send to Manager"), at: "2026-10-22T08:05:00.000Z", by: sent, internalNote: "Hold it" }),
      event("recommend_code", { audience: "internal", at: "2026-10-22T08:05:00.000Z", by: sent, recommendedCode: "C" }),
    ];
    expect(recommendedCodeSent(events)).toEqual({ code: "C", by: sent, at: "2026-10-22T08:05:00.000Z", internalNote: "Hold it" });
    expect(recommendedCodeSent([events[2]!])).toMatchObject({ internalNote: null });
    expect(recommendedCodeSent(events.slice(0, 2))).toBeNull();
  });

  it("the checklist the code shared, matched to the copy it answered; none before the code", () => {
    expect(sharedChecklists(history, [copy])).toEqual([{ fieldKey: "inspection_checklist", copyOf: "checklist_template", name: text("Cable trays"), items, answers: answered }]);
    expect(sharedChecklists(history.slice(0, 2), [copy])).toEqual([]);
  });
});

describe("Requested for", () => {
  it("is a plain date and time in Riyadh, Latin digits in both languages: no countdown, no comparison with today", () => {
    expect(requestedForText("2026-11-02T06:00:00.000Z", "en")).toBe("2 Nov 2026 · 09:00");
    expect(requestedForText("2026-11-02T06:00:00.000Z", "ar")).toMatch(/^2 .+ 2026 · 09:00$/);
  });

  it("nothing for an answer that isn't a date and time", () => {
    expect(requestedForText(undefined, "en")).toBeNull();
    expect(requestedForText("soon", "en")).toBeNull();
  });
});

describe("the items a save carries", () => {
  it("each item whose answer, comment or tick differs from what was saved, added or taken away", () => {
    const saved = { supports: { answer: "pass" }, earthing: { answer: "fail", comment: "Jumpers" }, clearance: { answer: "na" } };
    const now = { supports: { answer: "pass" }, earthing: { answer: "fail", comment: "Jumpers", snag: false as const }, labels: { answer: "pass" } };
    expect(changedItems(saved, now)).toEqual(["earthing", "labels", "clearance"]);
    expect(changedItems(saved, saved)).toEqual([]);
  });
});

describe("the filter chips", () => {
  const answers = { supports: { answer: "pass" }, earthing: { answer: "fail" }, cubes: { answer: "no" }, labels: { comment: "Later" } };

  it("All shows every item, Unanswered those with no answer, Failed those answered Fail or No, in the checklist's order", () => {
    expect(itemsShown(items, answers, "all")).toEqual(["supports", "earthing", "clearance", "labels", "cubes"]);
    expect(itemsShown(items, answers, "unanswered")).toEqual(["clearance", "labels"]);
    expect(itemsShown(items, answers, "failed")).toEqual(["earthing", "cubes"]);
  });
});
