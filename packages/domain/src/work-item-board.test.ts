import { describe, expect, it } from "vitest";
import { boardLanes, workItemViewFromSearchParams, type BoardCardInput } from "./work-item-board.ts";
import type { WorkItemRow } from "./work-item.ts";

const b = (en: string) => ({ en, ar: en });
const own = b("Tamkeen");
const k1 = "0192e0a0-0000-7000-8000-0000000000a1";
const k2 = "0192e0a0-0000-7000-8000-0000000000b2";

let n = 0;
function card(w: WorkItemRow["with"], holderParticipantId: string | null = null): BoardCardInput {
  n += 1;
  return {
    holderParticipantId,
    card: {
      id: `0192e0a0-0000-7000-8000-${String(n).padStart(12, "0")}`,
      projectId: "0192e0a0-0000-7000-8000-000000000100",
      type: { code: "MAR", name: b("Material") },
      title: `Item ${n}`,
      documentNumber: null,
      revisionNo: 0,
      stage: { key: "pending_approval", name: b("Pending"), category: "in_progress" },
      trade: { id: "0192e0a0-0000-7000-8000-000000000200", code: "EL", name: b("Electrical") },
      location: null,
      stepEnteredAt: "2026-09-01T00:00:00.000Z",
      stepAgeWeeks: 1,
      outcome: null,
      submissionDate: null,
      creationDate: null,
      with: w,
    },
  };
}
const ownStep = (key: string, name: string): WorkItemRow["with"] => ({ kind: "own", companyName: own, step: { key, name: b(name) }, claimer: null });
const company = (name: string): WorkItemRow["with"] => ({ kind: "company", companyName: b(name) });

describe("boardLanes", () => {
  it("makes each own Step a lane, each other Company one lane, and closed items a lane of their own, in that order", () => {
    const cards = [
      card(company("Zeta PMC"), k2),
      card(ownStep("review", "Review")),
      card(null),
      card(company("Al Waha PMC"), k1),
      card(ownStep("draft", "Draft")),
      card(ownStep("review", "Review")),
      card(company("Al Waha PMC"), k1),
    ];
    const lanes = boardLanes(cards);
    expect(lanes.map((l) => (l.kind === "step" ? l.step.key : l.kind === "company" ? l.participantId : "closed"))).toEqual([
      "draft",
      "review",
      k1,
      k2,
      "closed",
    ]);
    expect(lanes.map((l) => l.count)).toEqual([1, 2, 2, 1, 1]);
    // Each lane keeps the order the cards came in.
    expect(lanes[1]!.cards.map((c) => c.id)).toEqual([cards[1]!.card.id, cards[5]!.card.id]);
    expect(lanes[2]).toMatchObject({ kind: "company", companyName: b("Al Waha PMC") });
  });

  it("keeps another Company's lane to its name: no Step or person", () => {
    const [lane] = boardLanes([card(company("Al Waha PMC"), k1)]);
    expect(Object.keys(lane!).sort()).toEqual(["cards", "companyName", "count", "kind", "participantId"]);
  });

  it("puts a card whose holder isn't known in the closed lane, naming nobody", () => {
    expect(boardLanes([card(company("Al Waha PMC"), null)]).map((l) => l.kind)).toEqual(["closed"]);
  });

  it("has no lanes for no cards", () => {
    expect(boardLanes([])).toEqual([]);
  });
});

describe("workItemViewFromSearchParams", () => {
  it("reads the Kanban from view=kanban, and the List from anything else", () => {
    expect(workItemViewFromSearchParams(new URLSearchParams("view=kanban&stage=draft"))).toBe("kanban");
    expect(workItemViewFromSearchParams({ view: ["kanban", "list"] })).toBe("kanban");
    expect(workItemViewFromSearchParams({ view: "list" })).toBe("list");
    expect(workItemViewFromSearchParams({ view: "board" })).toBe("list");
    expect(workItemViewFromSearchParams({})).toBe("list");
  });
});
