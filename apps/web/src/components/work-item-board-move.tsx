"use client";

import type { Locale, WorkItemMove, WorkItemRow } from "@rabaed/domain";
import { TransitionDialog, useWorkItemCalls } from "@/components/transition-dialog";

/**
 * The Action Form of the Transition a Kanban card was dropped on, or chosen
 * from its Move menu (RP-350): the item page's own pop-up and calls
 * (`TransitionDialog`), so a refusal reads the same in both places. The card
 * moves after the refresh.
 */
export function WorkItemBoardMove({
  card,
  move,
  locale,
  onClose,
}: {
  card: WorkItemRow;
  move: WorkItemMove;
  locale: Locale;
  onClose: () => void;
}) {
  const calls = useWorkItemCalls(card.id);
  return (
    <TransitionDialog
      transition={{ key: move.transition, label: move.label, actionForm: move.actionForm }}
      calls={calls}
      locale={locale}
      description={card.title}
      idPrefix="board-transition"
      onClose={onClose}
    />
  );
}
