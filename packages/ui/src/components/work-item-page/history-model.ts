import type { BilingualText } from "@rabaed/domain";
import {
  sameName,
  sharedTexts,
  toneOfCode,
  written,
  type SubmittalTimelineEvent,
  type SubmittalTimelineOutcomes,
  type SubmittalTimelineText,
  type SubmittalTimelineTone,
} from "../submittal-panel/timeline-model.ts";

/**
 * The Work Item page's History (RP-1151, gap table rows 60–63): every event the history read gives
 * the viewer, newest first, each numbered as the viewer sees them (1 the oldest they read). The read
 * already leaves out another Participant's internal events (V5); the viewer's own are marked.
 * Nothing it hides is put back: another Company's people are never named here, but for whoever
 * issued the Code (V14), and only the viewer's own people come with their Positions.
 */
export type WorkItemHistoryEntry = {
  /** Its number as the viewer reads the History: 1 the oldest. */
  n: number;
  event: SubmittalTimelineEvent;
  /** Internal Communication of the viewer's own Participant (V5). */
  internal: boolean;
  /** Who acted, by name: the viewer's own people, or the Code's signer; null for anyone else. */
  person: BilingualText | null;
  /** The person's Positions: the viewer's own people only. */
  positions: readonly BilingualText[];
  /** What was written with it: a Cover Note, the Remarks, a reason, an Internal Note. */
  texts: SubmittalTimelineText[];
  tone: SubmittalTimelineTone;
};

/** The approval log's shared texts (the Cover Note, the Remarks), then a reason and an Internal Note. */
function textsOf(event: SubmittalTimelineEvent): SubmittalTimelineText[] {
  return [
    ...sharedTexts(event),
    // An `assigned` event's reason is why it was handed over, which its label already says.
    ...(written(event.reason) && event.type !== "assigned" ? [{ kind: "reason" as const, text: event.reason }] : []),
    ...(written(event.internalNote) ? [{ kind: "internalNote" as const, text: event.internalNote }] : []),
  ];
}

export function workItemHistoryEntries({
  events,
  viewerCompany,
  outcomes = [],
}: {
  /** The history read's events, oldest first, as it gives them. */
  events: readonly SubmittalTimelineEvent[];
  /** The viewer's own Company (`GET /v1/me`), by the legal name the history names Companies by; null when unknown, which names nobody. */
  viewerCompany: BilingualText | null;
  /** The item's Type's outcomes on the Project, to tone a Code by its place in the set. */
  outcomes?: SubmittalTimelineOutcomes;
}): WorkItemHistoryEntry[] {
  const tone = (event: SubmittalTimelineEvent): SubmittalTimelineTone =>
    toneOfCode(event.outcome ?? event.recommendedCode, outcomes) ?? (event.reason !== null && event.type !== "assigned" ? "warn" : "neutral");
  return events
    .map((event, i): WorkItemHistoryEntry => {
      const own = sameName(event.by.companyName, viewerCompany);
      // Another Company by name only, but for whoever issued the Code (V14); never more than the read gives.
      const person = own || event.type === "issue_code" ? event.by.memberName : null;
      return {
        n: i + 1,
        event,
        internal: event.audience === "internal",
        person,
        positions: own && person !== null ? event.by.positions : [],
        texts: textsOf(event),
        tone: tone(event),
      };
    })
    .reverse();
}
