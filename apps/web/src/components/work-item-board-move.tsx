"use client";

import type { Locale, WorkItemMove, WorkItemRow } from "@rabaed/domain";
import { useToast } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { StampRequired, useMyCompanyRead } from "@/components/company-stamp";
import { SignatureRequired, useMySignatureRead } from "@/components/signature";
import { TransitionDialog, useWorkItemCalls } from "@/components/transition-dialog";
import { mapRead, transitionGate } from "@/lib/transition-gate";

/**
 * The Action Form of the Transition a Kanban card was dropped on, or chosen
 * from its Move menu (RP-350): the item page's own pop-up and calls
 * (`TransitionDialog`), so a refusal reads the same in both places. The card
 * moves after the refresh. A Member without a Signature gets the pop-up that
 * sends them to Add Signature and back to the item's own page instead, before
 * any Action Form (RP-85; the board can't reopen the move); then a Member whose
 * Company has no Stamp gets the message that its Authorized Person must add it
 * (RP-617). Both are asked when the move opens; if either can't be read, the
 * move stays closed with an error, so no answers are typed and lost.
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
  const t = useTranslations("workItems.actions");
  const toast = useToast();
  const calls = useWorkItemCalls(card.id);
  const signature = useMySignatureRead(true);
  const company = useMyCompanyRead(true);
  const gate = transitionGate({
    hasSignature: mapRead(signature, (mine) => mine.signature !== null),
    hasStamp: mapRead(company, (mine) => mine.stamp !== null),
    company,
  });
  const unavailable = gate.show === "unavailable";
  useEffect(() => {
    if (!unavailable) return;
    toast({ title: t("gateUnavailable"), tone: "danger" });
    onClose();
  }, [unavailable, toast, t, onClose]);

  switch (gate.show) {
    case "wait":
    case "unavailable":
      return null;
    case "signature":
      return <SignatureRequired open onOpenChange={(open) => !open && onClose()} returnTo={`/work-items/${card.id}`} />;
    case "stamp":
      return <StampRequired open onOpenChange={(open) => !open && onClose()} company={gate.company} />;
    case "actionForm":
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
}
