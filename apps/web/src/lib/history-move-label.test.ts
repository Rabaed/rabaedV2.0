import type { WorkItemHistory } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { historyMoveLabel, type HistoryTranslator } from "./history-move-label.ts";

type Event = WorkItemHistory["events"][number];

const name = (text: string) => ({ en: text, ar: `${text} (ar)` });
/** A translator that shows the message key and its values, so a test reads which message was picked. */
const t: HistoryTranslator = (key, values) => (values ? `${key}(${Object.entries(values).map(([k, v]) => `${k}=${v}`).join(", ")})` : key);
const event = (overrides: Partial<Event>): Event => ({
  seq: 1,
  type: "assigned",
  at: "2026-10-31T09:00:00.000Z",
  audience: "internal",
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
  ...overrides,
});

describe("historyMoveLabel: a Rabaed Engineer's reassign (RP-1162)", () => {
  const byRabaed = (from: string | null, to: string | null) =>
    event({ type: "admin_reassigned", handover: { from: from === null ? null : name(from), to: to === null ? null : name(to), because: "reassigned" } });

  it("reads as Rabaed's, from the holder to the new one, in the page's language", () => {
    expect(historyMoveLabel(byRabaed("Ali", "Khalid"), "en", t)).toBe("reassignedByRabaed(from=Ali, to=Khalid)");
    expect(historyMoveLabel(byRabaed("Ali", "Khalid"), "ar", t)).toBe("reassignedByRabaed(from=Ali (ar), to=Khalid (ar))");
  });

  it("reads as assigned by Rabaed when nobody had picked it up", () => {
    expect(historyMoveLabel(byRabaed(null, "Khalid"), "en", t)).toBe("assignedByRabaed(to=Khalid)");
  });

  it("reads as returned to the pool by Rabaed when nobody holds it after", () => {
    expect(historyMoveLabel(byRabaed("Khalid", null), "en", t)).toBe("returnedToPoolByRabaed");
  });

  it("leaves a Member's own reassign as it was", () => {
    expect(historyMoveLabel(event({ handover: { from: name("Ali"), to: name("Khalid"), because: "reassigned" } }), "en", t)).toBe("reassigned(from=Ali, to=Khalid)");
  });
});
