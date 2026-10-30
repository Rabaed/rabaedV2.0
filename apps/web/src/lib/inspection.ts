import { checklistAnswerSets, formatDate, isNegativeAnswer, snagTick, type BilingualText, type Locale, type ChecklistAnswers, type ChecklistCopy, type ChecklistItem, type ChecklistTemplateItem, type WorkItemActions, type WorkItemHistory } from "@rabaed/domain";

// The WIR screens' own reading of the Consultant Engineer's checklist (RP-655): what the summary
// bar, the tiles, the filter chips, the Send to Manager sheet and the code pop-up show. Counted
// from the answers, never stored (form-engine.md §3).

/** How a checklist stands: passed (Pass, Yes), failed (Fail, No), N/A, how many are answered, of how many. */
export type InspectionTally = { passed: number; failed: number; na: number; answered: number; total: number };

/** `item`'s answer in `answers` when its answer set offers it; undefined when not answered (a comment alone, or an answer the set doesn't take). */
function answerOf(item: ChecklistItem, answers: ChecklistAnswers): string | undefined {
  const answer = answers[item.key]?.answer;
  return answer !== undefined && (checklistAnswerSets[item.answers] as readonly string[]).includes(answer) ? answer : undefined;
}

/** A Snag the code will raise: its check item, numbered as the checklist numbers it. */
export type SnagToRaise = { key: string; number: number; text: BilingualText };

/**
 * The Snags the code will raise, whatever the code (RP-577, ADR 0025): each item answered Fail or
 * No whose template raises one and whose "Raise a Snag" tick is still on; and how many were unticked.
 */
export function snagsToRaise(items: readonly ChecklistItem[], answers: ChecklistAnswers): { ticked: SnagToRaise[]; unticked: number } {
  const ticked: SnagToRaise[] = [];
  let unticked = 0;
  items.forEach((item, index) => {
    const tick = snagTick(item, answers[item.key]);
    if (tick === "ticked") ticked.push({ key: item.key, number: index + 1, text: item.text });
    else if (tick === "unticked") unticked++;
  });
  return { ticked, unticked };
}

type Offered = WorkItemActions["transitions"][number];

/**
 * The WIR page's actions, each one the API offers and nothing else: `send`, the move that
 * Recommends a Code (Send to Manager), in the summary bar; `codes`, the Transitions whose Screens
 * take the checklist, the code pop-up's choices in the API's order, `proposed` the one its
 * checklist proposes (ADR 0025); `others`, every other offered Transition, a button as on any item.
 */
export function inspectionActions(transitions: readonly Offered[]): { send: Offered | null; codes: Offered[]; proposed: string | null; others: Offered[] } {
  const send = transitions.find((t) => t.recommendCode !== undefined && t.checklists === undefined) ?? null;
  const codes = transitions.filter((t) => t.checklists !== undefined && t.checklists.length > 0);
  return {
    send,
    codes,
    proposed: codes.find((t) => t.proposed)?.key ?? null,
    others: transitions.filter((t) => t !== send && !codes.includes(t)),
  };
}

/**
 * "Requested for" as the page shows it: a plain date and time in Riyadh, Latin digits (RP-655). A
 * value only, never compared with today: no countdown, no colour, no "late" (CLAUDE.md, spec RP-649
 * story 3). Null for an answer that isn't a date and time.
 */
export function requestedForText(value: unknown, locale: Locale): string | null {
  if (typeof value !== "string") return null;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  // Day, month, year, as the design writes it in both languages ("21 Oct 2026").
  const date = (["day", "month", "year"] as const)
    .map((part) => formatDate(at, locale, { [part]: part === "month" ? "short" : "numeric" }))
    .join(" ");
  return `${date} · ${timeOfDay(at, locale)}`;
}

/** A time of day as the WIR screens write it, 24-hour, Latin digits: 09:00. */
export const timeOfDay = (at: Date, locale: Locale): string => formatDate(at, locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

type HistoryEvent = WorkItemHistory["events"][number];

/** A text on the WIR page from its history: its text, who wrote it as the history names them (V14), and when. */
export type HistoryText = { text: string; by: HistoryEvent["by"]; at: string };

const lastEvent = (events: readonly HistoryEvent[], matches: (e: HistoryEvent) => boolean) => events.findLast(matches) ?? null;

/** The Cover Note the item was Submitted with (the last shared answer `cover_note`); null when there is none. */
export function coverNote(events: readonly HistoryEvent[]): HistoryText | null {
  const submit = lastEvent(events, (e) => e.type === "transition" && typeof e.answers?.cover_note === "string");
  return submit ? { text: submit.answers!.cover_note as string, by: submit.by, at: submit.at } : null;
}

/** The code's reply: its Remarks, its signer (named to everyone who sees it, V14) and when; null before the code or without Remarks. */
export function codeRemarks(events: readonly HistoryEvent[]): HistoryText | null {
  const code = lastEvent(events, (e) => e.type === "issue_code");
  return code?.remarks ? { text: code.remarks, by: code.by, at: code.at } : null;
}

/**
 * The Engineer's Recommended Code as the Manager reads it (RP-433, RP-86), internal to the Consultant
 * (V5): the last Recommended Code, who sent it and when, and the Internal Note sent with the same
 * move. Null when the viewer reads none (every other Company, and before one is sent).
 */
export function recommendedCodeSent(
  events: readonly HistoryEvent[],
): { code: NonNullable<HistoryEvent["recommendedCode"]>; by: HistoryEvent["by"]; at: string; internalNote: string | null } | null {
  const sent = lastEvent(events, (e) => e.type === "recommend_code" && e.recommendedCode !== null);
  if (!sent) return null;
  // One Transition writes both in one transaction, so they carry the same time.
  const withIt = lastEvent(events, (e) => e.type === "internal_note" && e.at === sent.at && e.internalNote !== null);
  return { code: sent.recommendedCode!, by: sent.by, at: sent.at, internalNote: withIt?.internalNote ?? null };
}

/** A checklist as the code shared it (RP-86): the copy it answered and the answers the code took. */
export type SharedChecklist = { fieldKey: string; copyOf: string; name: BilingualText; items: ChecklistTemplateItem[]; answers: ChecklistAnswers };

/** The checklists the last code took, each matched to the copy it answered; empty before the code. */
export function sharedChecklists(events: readonly HistoryEvent[], copies: readonly ChecklistCopy[]): SharedChecklist[] {
  const code = lastEvent(events, (e) => e.type === "issue_code");
  if (!code?.answers || !code.answersForm) return [];
  return code.answersForm.sections
    .flatMap((s) => s.fields)
    .flatMap((field) => {
      if (field.type !== "copied_checklist") return [];
      const copy = copies.find((c) => c.fieldKey === field.copyOf);
      const answers = code.answers?.[field.key];
      if (!copy || typeof answers !== "object" || answers === null) return [];
      return [{ fieldKey: field.key, copyOf: field.copyOf, name: copy.name, items: copy.items, answers: answers as ChecklistAnswers }];
    });
}

const sameEntry = (a: ChecklistAnswers[string] | undefined, b: ChecklistAnswers[string] | undefined) =>
  a?.answer === b?.answer && (a?.comment ?? "") === (b?.comment ?? "") && a?.snag === b?.snag;

/** The items whose answer, comment or "Raise a Snag" tick differ between `saved` and `now`: those now first, then those taken away. */
export function changedItems(saved: ChecklistAnswers, now: ChecklistAnswers): string[] {
  const keys = [...Object.keys(now), ...Object.keys(saved).filter((k) => !(k in now))];
  return keys.filter((key) => !sameEntry(saved[key], now[key]));
}

/** The filter chips over the check items: all of them, the unanswered, the failed. */
export const itemFilters = ["all", "unanswered", "failed"] as const;
export type ItemFilter = (typeof itemFilters)[number];

/** The keys of the items `filter` shows, in the checklist's order. */
export function itemsShown(items: readonly ChecklistItem[], answers: ChecklistAnswers, filter: ItemFilter): string[] {
  return items
    .filter((item) => {
      if (filter === "all") return true;
      const answer = answerOf(item, answers);
      return filter === "unanswered" ? answer === undefined : answer !== undefined && isNegativeAnswer(answer);
    })
    .map((item) => item.key);
}

export function inspectionTally(items: readonly ChecklistItem[], answers: ChecklistAnswers): InspectionTally {
  const tally: InspectionTally = { passed: 0, failed: 0, na: 0, answered: 0, total: items.length };
  for (const item of items) {
    const answer = answerOf(item, answers);
    if (answer === undefined) continue;
    tally.answered++;
    if (answer === "na") tally.na++;
    else if (isNegativeAnswer(answer)) tally.failed++;
    else tally.passed++;
  }
  return tally;
}
