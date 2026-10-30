import type { WorkItemHistory } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { submittalApprovalLog, submittalInternalLog, submittalPositionsText } from "./timeline-model.ts";

// "Name · Position · Company" (RP-1091): a person's several Positions read as one list in the page's language.
describe("a person's Positions in words", () => {
  const engineer = b("Engineer", "مهندس");
  const pm = b("Project Manager", "مدير المشروع");

  it("joins several as a list in English and in Arabic", () => {
    expect(submittalPositionsText([engineer, pm], "en")).toBe("Engineer and Project Manager");
    expect(submittalPositionsText([engineer, pm], "ar")).toBe("مهندس ومدير المشروع");
  });

  it("gives one as it is, and none for no Position", () => {
    expect(submittalPositionsText([pm], "ar")).toBe("مدير المشروع");
    expect(submittalPositionsText([], "en")).toBeNull();
  });
});

type Event = WorkItemHistory["events"][number];

// A name in both languages, built as data (the package has no translations of its own).
const b = (en: string, ar: string = en) => Object.fromEntries([["en", en], ["ar", ar]]) as { en: string; ar: string };

const contractor = b("TMC Constructions", "تي إم سي للمقاولات");
const consultant = b("Design Consultants LLC", "ديزاين للاستشارات");

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

describe("the approval log", () => {
  it("keeps only the shared moves, newest first", () => {
    const submit = event({ type: "transition", audience: "shared", transition: b("Submit"), by: { companyName: contractor, memberName: b("Sara Al Harbi"), positions: [] } });
    const note = event({ type: "internal_note", audience: "internal", internalNote: "Check the datasheet", by: { companyName: contractor, memberName: b("Sara Al Harbi"), positions: [] } });
    const code = event({ type: "issue_code", audience: "shared", transition: b("Code A"), outcome: "A", by: { companyName: consultant, memberName: b("Omar Haddad"), positions: [] } });

    const log = submittalApprovalLog({ events: [submit, note, code], viewerCompany: contractor, creationDate: null });

    expect(log.map((e) => (e.kind === "event" ? e.event.seq : e.kind))).toEqual([code.seq, "review", submit.seq]);
  });

  // Visibility "Creation Date" row: only the raiser's Participant reads when the item got its number.
  it("starts at Created for the raiser's Participant, and at the Submit for everyone else", () => {
    const submit = event({ type: "transition", audience: "shared", transition: b("Submit"), by: { companyName: contractor, memberName: null, positions: [] } });

    const raiser = submittalApprovalLog({ events: [submit], viewerCompany: contractor, creationDate: "2026-10-01T08:00:00.000Z" });
    const consultantView = submittalApprovalLog({ events: [submit], viewerCompany: consultant, creationDate: null });

    expect(raiser.at(-1)).toEqual({ kind: "created", at: "2026-10-01T08:00:00.000Z" });
    expect(consultantView.map((e) => e.kind)).toEqual(["event"]);
  });

  // Scenario RP-1067-1 (V5, V14): the Contractor's log names no Consultant person but the final Code's
  // signer, and shows no Recommended Code and no Consultant internal move; its own people are named.
  it("names only the viewer's own people and the final Code's signer, and keeps internal moves out", () => {
    const submit = event({
      type: "transition",
      audience: "shared",
      transition: b("Submit"),
      by: { companyName: contractor, memberName: b("Sara Al Harbi"), positions: [] },
      answers: { cover_note: "Lighting fixtures, Level 3", internal_note: "never here" },
    });
    // Even were a shared Send Back to name a Consultant person, the log would show the Company only.
    const sendBack = event({ type: "transition", audience: "shared", transition: b("Send Back"), reason: "Wrong sheet", by: { companyName: consultant, memberName: b("Khalid Engineer"), positions: [] } });
    const resubmit = event({ type: "transition", audience: "shared", transition: b("Submit"), by: { companyName: contractor, memberName: b("Sara Al Harbi"), positions: [] } });
    // The Consultant's internal moves and Recommended Code, as the Consultant's read would give them.
    const internalMove = event({ type: "transition", audience: "internal", transition: b("Send to Manager"), by: { companyName: consultant, memberName: b("Khalid Engineer"), positions: [] } });
    const recommend = event({ type: "recommend_code", audience: "internal", recommendedCode: "B", by: { companyName: consultant, memberName: b("Khalid Engineer"), positions: [] } });
    const code = event({
      type: "issue_code",
      audience: "shared",
      transition: b("Code B"),
      outcome: "B",
      remarks: "Use the revised fixings",
      by: { companyName: consultant, memberName: b("Omar Haddad"), positions: [] },
    });

    const log = submittalApprovalLog({ events: [submit, sendBack, resubmit, internalMove, recommend, code], viewerCompany: contractor, creationDate: null });
    const shown = log.flatMap((e) => (e.kind === "event" ? [e] : []));

    expect(shown.map((e) => e.event.seq)).toEqual([code.seq, resubmit.seq, sendBack.seq, submit.seq]);
    expect(shown.map((e) => e.person?.en ?? null)).toEqual(["Omar Haddad", "Sara Al Harbi", null, "Sara Al Harbi"]);
    expect(JSON.stringify(log)).not.toContain('"recommendedCode":"B"');
    // Text: the Cover Note with a Submit, the Remarks with a Code; a Send Back's reason is not the log's.
    expect(shown.map((e) => e.texts)).toEqual([
      [{ kind: "remarks", text: "Use the revised fixings" }],
      [],
      [],
      [{ kind: "coverNote", text: "Lighting fixtures, Level 3" }],
    ]);
  });

  // Scenario RP-1091-1 (V14): the viewer's own people with the Positions the read gives; the final Code's
  // signer of another Company by name, with none, and another Company's turn with no one.
  it("gives the viewer's own people their Positions, as the read gives them, and nobody else any", () => {
    const engineer = b("Engineer", "مهندس");
    const pm = b("Project Manager", "مدير المشروع");
    const submit = event({ type: "transition", audience: "shared", transition: b("Submit"), by: { companyName: contractor, memberName: b("Sara Al Harbi"), positions: [engineer, pm] } });
    const sendBack = event({ type: "transition", audience: "shared", transition: b("Send Back"), by: { companyName: consultant, memberName: null, positions: [] } });
    // Even were the read to give the signer's Position, the log would show the name only.
    const code = event({ type: "issue_code", audience: "shared", transition: b("Code A"), outcome: "A", by: { companyName: consultant, memberName: b("Omar Haddad"), positions: [b("Manager")] } });

    const log = submittalApprovalLog({ events: [submit, sendBack, code], viewerCompany: contractor, creationDate: null });
    const shown = log.flatMap((e) => (e.kind === "event" ? [[e.person?.en ?? null, e.positions.map((p) => p.en)]] : []));

    expect(shown).toEqual([
      ["Omar Haddad", []],
      [null, []],
      ["Sara Al Harbi", ["Engineer", "Project Manager"]],
    ]);
  });

  // Until `GET /v1/me` answers (or if it fails), the viewer's own turns are never drawn as another Company's.
  it("takes no turn for another Company's while the viewer's Company is unknown", () => {
    const submit = event({ type: "transition", audience: "shared", transition: b("Submit"), by: { companyName: contractor, memberName: b("Sara Al Harbi"), positions: [] } });
    const code = event({ type: "issue_code", audience: "shared", transition: b("Code A"), outcome: "A", by: { companyName: consultant, memberName: b("Omar Haddad"), positions: [] } });

    const log = submittalApprovalLog({ events: [submit, code], viewerCompany: null, creationDate: null });

    expect(log.map((e) => e.kind)).toEqual(["event", "event"]);
    expect(log.map((e) => (e.kind === "event" ? e.person?.en : null))).toEqual(["Omar Haddad", "Sara Al Harbi"]);
  });

  it("colours each move by its Code, and a Send Back amber", () => {
    const submit = event({ type: "transition", audience: "shared", transition: b("Submit"), by: { companyName: contractor, memberName: null, positions: [] } });
    const sendBack = event({ type: "transition", audience: "shared", transition: b("Send Back"), reason: "Wrong sheet", by: { companyName: consultant, memberName: null, positions: [] } });
    const codeA = event({ type: "issue_code", audience: "shared", transition: b("Code A"), outcome: "A", by: { companyName: consultant, memberName: b("Omar Haddad"), positions: [] } });
    const codeB = event({ type: "issue_code", audience: "shared", transition: b("Code B"), outcome: "B", by: { companyName: consultant, memberName: b("Omar Haddad"), positions: [] } });
    const codeC = event({ type: "issue_code", audience: "shared", transition: b("Code C"), outcome: "C", by: { companyName: consultant, memberName: b("Omar Haddad"), positions: [] } });

    const tones = [submit, sendBack, codeA, codeB, codeC].map((e) => {
      const [entry] = submittalApprovalLog({ events: [e], viewerCompany: contractor, creationDate: null, outcomes: reviewCodes });
      return entry?.kind === "event" ? entry.tone : null;
    });

    expect(tones).toEqual(["neutral", "warn", "ok", "warn", "bad"]);
  });

  // Gap A8: Code B's chip counts the Comments the item read counts for the viewer, and none is no chip.
  it("puts the Comments the viewer sees on Code B's chip", () => {
    const codeB = event({ type: "issue_code", audience: "shared", transition: b("Code B"), outcome: "B", by: { companyName: consultant, memberName: b("Omar Haddad"), positions: [] } });
    const comments = (raisedItems: { type: { code: string }; open: number; closed: number }[]) => {
      const [entry] = submittalApprovalLog({ events: [codeB], viewerCompany: contractor, creationDate: null, outcomes: reviewCodes, raisedItems });
      return entry?.kind === "event" ? entry.comments : undefined;
    };

    expect(comments([{ type: { code: "SNG" }, open: 4, closed: 0 }, { type: { code: "CMT" }, open: 2, closed: 1 }])).toEqual({ typeCode: "CMT", count: 3 });
    expect(comments([])).toBeNull();
  });
});

describe("Internal Communication", () => {
  // Scenario RP-1067-3 (V5): the tab holds the viewer's own Participant's internal entries only, never a
  // shared move or another Participant's; the positive control is the Consultant's own Recommended Code.
  it("holds only the internal entries the read gives the viewer, newest first, with their own text", () => {
    const submit = event({ type: "transition", audience: "shared", transition: b("Submit"), by: { companyName: contractor, memberName: null, positions: [] } });
    const move = event({ type: "transition", audience: "internal", transition: b("Send to Manager"), by: { companyName: consultant, memberName: b("Khalid Engineer"), positions: [] } });
    const note = event({ type: "internal_note", audience: "internal", transition: b("Send to Manager"), internalNote: "Datasheet page 4 differs", by: { companyName: consultant, memberName: b("Khalid Engineer"), positions: [] } });
    const recommend = event({ type: "recommend_code", audience: "internal", recommendedCode: "B", by: { companyName: consultant, memberName: b("Khalid Engineer"), positions: [] } });
    const returned = event({ type: "transition", audience: "internal", transition: b("Return"), reason: "Add the fixing detail", by: { companyName: consultant, memberName: b("Omar Haddad"), positions: [] } });
    const code = event({ type: "issue_code", audience: "shared", transition: b("Code B"), outcome: "B", by: { companyName: consultant, memberName: b("Omar Haddad"), positions: [] } });

    const log = submittalInternalLog([submit, move, note, recommend, returned, code], reviewCodes);

    expect(log.map((e) => e.event.seq)).toEqual([returned.seq, recommend.seq, note.seq, move.seq]);
    expect(log.map((e) => e.texts)).toEqual([[{ kind: "reason", text: "Add the fixing detail" }], [], [{ kind: "internalNote", text: "Datasheet page 4 differs" }], []]);
    expect(log.map((e) => e.tone)).toEqual(["warn", "warn", "neutral", "neutral"]);
    expect(log.map((e) => e.person?.en)).toEqual(["Omar Haddad", "Khalid Engineer", "Khalid Engineer", "Khalid Engineer"]);
  });

  // Scenario RP-1091-2: the viewer's own people with the Positions the read gives.
  it("gives each internal entry's person their Positions, as the read gives them", () => {
    const manager = b("Manager", "مدير");
    const note = event({ type: "internal_note", audience: "internal", internalNote: "Fixings differ", by: { companyName: consultant, memberName: b("Omar Haddad"), positions: [manager] } });

    expect(submittalInternalLog([note]).map((e) => [e.person?.en, e.positions])).toEqual([["Omar Haddad", [manager]]]);
  });
});

/** The Rabaed default Review Codes: A clean, B with Comments (CMT), C a Revision, D a replacement. */
const reviewCodes = [
  { code: "A", polarity: "positive" as const, actions: [] },
  { code: "B", polarity: "positive" as const, actions: [{ kind: "create_items" as const, type: "CMT" }] },
  { code: "C", polarity: "negative" as const, actions: [{ kind: "offer_revision" as const }] },
  { code: "D", polarity: "negative" as const, actions: [{ kind: "offer_replacement" as const }] },
];
