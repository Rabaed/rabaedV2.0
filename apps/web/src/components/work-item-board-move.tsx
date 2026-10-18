"use client";

import type { Locale, MyCompany, MySignature, WorkItemMove, WorkItemRow } from "@rabaed/domain";
import { useEffect, useState } from "react";
import { StampRequired } from "@/components/company-stamp";
import { SignatureRequired } from "@/components/signature";
import { TransitionDialog, useWorkItemCalls } from "@/components/transition-dialog";
import { usePathname } from "@/i18n/navigation";

/**
 * The Action Form of the Transition a Kanban card was dropped on, or chosen
 * from its Move menu (RP-350): the item page's own pop-up and calls
 * (`TransitionDialog`), so a refusal reads the same in both places. The card
 * moves after the refresh. A Member without a Signature gets the pop-up that
 * sends them to Add Signature and back to the board instead, before any
 * Action Form (RP-85); then a Member whose Company has no Stamp gets the
 * message that its Authorized Person must add it (RP-617).
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
  // Their own Company, with its Stamp or none (RP-617): asked at the same time.
  const [company, setCompany] = useState<MyCompany | null | undefined>(undefined);
  useEffect(() => {
    let current = true;
    fetch("/api/v1/me/signature")
      .then((res) => (res.ok ? (res.json() as Promise<MySignature>) : null))
      // Unanswered: the Action Form opens, and taking it says why if it is refused.
      .then((mine) => current && setSigned(mine ? mine.signature !== null : true))
      .catch(() => current && setSigned(true));
    fetch("/api/v1/me/company")
      .then((res) => (res.ok ? (res.json() as Promise<MyCompany>) : null))
      .then((mine) => current && setCompany(mine))
      .catch(() => current && setCompany(null));
    return () => {
      current = false;
    };
  }, []);

  if (signed === null || company === undefined) return null;
  if (!signed) return <SignatureRequired open onOpenChange={(open) => !open && onClose()} returnTo={pathname} />;
  // Unanswered (null): the Action Form opens, and taking it says why if it is refused.
  if (company && !company.stamp) return <StampRequired open onOpenChange={(open) => !open && onClose()} company={company} />;
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
