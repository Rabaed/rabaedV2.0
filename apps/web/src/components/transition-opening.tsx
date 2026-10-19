"use client";

import type { Locale } from "@rabaed/domain";
import { useToast } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useEffect, type ReactNode } from "react";
import { StampRequired, useMyCompanyRead } from "@/components/company-stamp";
import { SignatureRequired, useMySignatureRead } from "@/components/signature";
import { TransitionDialog, useWorkItemCalls, type TransitionChoice } from "@/components/transition-dialog";
import { mapRead, transitionGate } from "@/lib/transition-gate";

/**
 * A Transition opened away from its item's page (a Kanban move, RP-350; a bulk Transition on the
 * Package page, RP-661): it asks GET /v1/me/signature and GET /v1/me/company when it opens. A Member
 * without a Signature gets the pop-up that sends them to Add Signature and back to `returnTo`
 * (RP-85); then a Member whose Company has no Stamp gets the message that its Authorized Person
 * must add it (RP-617). Only then `children`, the Transition's own pop-up. If either can't be
 * read, it stays closed with an error, so no answers are typed and lost.
 */
export function TransitionOpening({ returnTo, onClose, children }: { returnTo: string; onClose: () => void; children: ReactNode }) {
  const t = useTranslations("workItems.actions");
  const toast = useToast();
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
      return <SignatureRequired open onOpenChange={(open) => !open && onClose()} returnTo={returnTo} />;
    case "stamp":
      return <StampRequired open onOpenChange={(open) => !open && onClose()} company={gate.company} />;
    case "actionForm":
      return children;
  }
}

/**
 * One of an item's own Transitions (from its `actions`), opened away from its page: the Snag List
 * card's swipe and the phone's Raise (RP-630). The Signature and Stamp checks, then its pop-up.
 */
export function TransitionPopup({
  workItemId,
  subject,
  transition,
  locale,
  idPrefix,
  onClose,
}: {
  workItemId: string;
  subject: string;
  transition: TransitionChoice;
  locale: Locale;
  idPrefix: string;
  onClose: () => void;
}) {
  const calls = useWorkItemCalls(workItemId);
  return (
    <TransitionOpening returnTo={`/work-items/${workItemId}`} onClose={onClose}>
      <TransitionDialog transition={transition} calls={calls} locale={locale} description={subject} idPrefix={idPrefix} onClose={onClose} />
    </TransitionOpening>
  );
}
