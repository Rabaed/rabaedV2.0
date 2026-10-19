"use client";

import type { Locale, WorkItemMove, WorkItemRow } from "@rabaed/domain";
import { TransitionDialog, useWorkItemCalls } from "@/components/transition-dialog";
import { TransitionOpening } from "@/components/transition-opening";

/**
 * The Action Form of the Transition a Kanban card was dropped on, or chosen
 * from its Move menu (RP-350): the item page's own pop-up and calls
 * (`TransitionDialog`), so a refusal reads the same in both places. The card
 * moves after the refresh. The Signature and the Stamp are asked first, when
 * the move opens (`TransitionOpening`); a Member without a Signature is sent
 * back to the item's own page after adding one (the board can't reopen the move).
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
    <TransitionOpening returnTo={`/work-items/${card.id}`} onClose={onClose}>
      <TransitionDialog
        transition={{ key: move.transition, label: move.label, actionForm: move.actionForm }}
        calls={calls}
        locale={locale}
        description={card.title}
        idPrefix="board-transition"
        onClose={onClose}
      />
    </TransitionOpening>
  );
}
