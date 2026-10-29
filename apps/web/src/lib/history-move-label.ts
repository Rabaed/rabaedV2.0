import type { Locale, WorkItemHistory } from "@rabaed/domain";

type Event = WorkItemHistory["events"][number];

/** The `workItems.history` messages a move's label uses. */
type MoveKey =
  | "internalNote"
  | "internalNoteWith"
  | "internalAnswersWith"
  | "recommendedCode"
  | "pickedUp"
  | "returnedToPool"
  | "reassigned"
  | "reassignedFromPool"
  | "handedOver"
  | "assignedOnlyMember"
  | "created"
  | "answersChanged"
  | "other";

/** A `workItems.history` translator: next-intl's `getTranslations` on the server, `useTranslations` in the browser. */
export type HistoryTranslator = (key: MoveKey, values?: Record<string, string>) => string;

/**
 * What a history event is called (the item page's history and the Submittal Panel's timeline,
 * RP-1067): a Transition or a Code by its Workflow label, anything else in the history's words.
 */
export function historyMoveLabel(e: Event, locale: Locale, t: HistoryTranslator): string {
  if ((e.type === "transition" || e.type === "issue_code") && e.transition) return e.transition[locale];
  if (e.type === "internal_note") return e.transition ? t("internalNoteWith", { transition: e.transition[locale] }) : t("internalNote");
  // A reply's answers internal to the viewer's own Participant (RP-516, V5).
  if (e.type === "internal_answers" && e.transition) return t("internalAnswersWith", { transition: e.transition[locale] });
  if (e.type === "recommend_code") return t("recommendedCode");
  if (e.type === "picked_up" || e.type === "claimed") return t("pickedUp");
  if (e.type === "returned_to_pool" || e.type === "released") return t("returnedToPool");
  // A Handover (RP-108): from whom to whom and why, internal to the holding Participant.
  if (e.type === "assigned" && e.handover?.because === "reassigned") {
    // Reassigned within the Company (RP-629): from the holder, or from the pool when nobody had picked it up.
    const to = e.handover.to?.[locale] ?? "";
    return e.handover.from ? t("reassigned", { from: e.handover.from[locale], to }) : t("reassignedFromPool", { to });
  }
  if (e.type === "assigned" && e.handover) {
    return t("handedOver", { from: e.handover.from?.[locale] ?? "", to: e.handover.to?.[locale] ?? "", because: e.handover.because });
  }
  // A pool of one (§3.3 rule 4): its actor is the holder, internal to their own Participant.
  if (e.type === "assigned" && e.by.memberName) return t("assignedOnlyMember", { name: e.by.memberName[locale] });
  if (e.type === "created") return t("created");
  if (e.type === "answers_changed") return t("answersChanged");
  return t("other");
}
