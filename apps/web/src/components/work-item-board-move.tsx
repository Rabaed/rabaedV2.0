"use client";

import type { Locale, MySignature, WorkItemMove, WorkItemRow } from "@rabaed/domain";
import { useEffect, useState } from "react";
import { SignatureRequired } from "@/components/signature";
import { TransitionDialog, useWorkItemCalls } from "@/components/transition-dialog";
import { usePathname } from "@/i18n/navigation";

/**
 * The Action Form of the Transition a Kanban card was dropped on, or chosen
 * from its Move menu (RP-350): the item page's own pop-up and calls
 * (`TransitionDialog`), so a refusal reads the same in both places. The card
 * moves after the refresh. A Member without a Signature gets the pop-up that
 * sends them to Add Signature and back to the board instead, before any
 * Action Form (RP-85).
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
  const pathname = usePathname();
  // Whether the Member has a Signature: asked when the move opens; unknown until answered.
  const [signed, setSigned] = useState<boolean | null>(null);
  useEffect(() => {
    let current = true;
    fetch("/api/v1/me/signature")
      .then((res) => (res.ok ? (res.json() as Promise<MySignature>) : null))
      // Unanswered: the Action Form opens, and taking it says why if it is refused.
      .then((mine) => current && setSigned(mine ? mine.signature !== null : true))
      .catch(() => current && setSigned(true));
    return () => {
      current = false;
    };
  }, []);

  if (signed === null) return null;
  if (!signed) return <SignatureRequired open onOpenChange={(open) => !open && onClose()} returnTo={pathname} />;
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
