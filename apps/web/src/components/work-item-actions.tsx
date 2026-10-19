"use client";

import { backwardKinds, type Locale, type WorkItemActions as Actions } from "@rabaed/domain";
import { Button } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { StampRequired, useMyCompanyRead } from "@/components/company-stamp";
import { SignatureRequired } from "@/components/signature";
import { TransitionDialog, useWorkItemCalls } from "@/components/transition-dialog";
import { loaded, transitionGate } from "@/lib/transition-gate";

type Transition = Actions["transitions"][number];

/**
 * Exactly the buttons the viewer may press on a Work Item, as the API lists them.
 * Each Transition opens its pop-up first (`TransitionDialog`, the same one a
 * Kanban move opens), or, while the viewer has no Signature, the pop-up that
 * sends them to Add Signature and back (RP-85), or, while their Company has no
 * Stamp, the message that its Authorized Person must add it (RP-617): its
 * buttons wait until that message's Company is read, and say so if it can't be.
 * Pick up and Return to pool are taken at once.
 */
export function WorkItemActions({
  workItemId,
  actions,
  locale,
}: {
  workItemId: string;
  actions: Actions;
  locale: Locale;
}) {
  const t = useTranslations("workItems.actions");
  const calls = useWorkItemCalls(workItemId);
  const [asking, setAsking] = useState<Transition | null>(null);
  // No Signature, no Transition (RP-85): the pop-up asks for one before the Action Form opens.
  const [needsSignature, setNeedsSignature] = useState(false);
  // No Stamp, no Transition (RP-617): the message names the Member's own Company, read when it is needed.
  const [needsStamp, setNeedsStamp] = useState(false);
  // The Company the message names: read only when it is needed. Until then a Transition waits for it.
  const company = useMyCompanyRead(actions.stampRequired);
  const gate = transitionGate({ hasSignature: loaded(!actions.signatureRequired), hasStamp: loaded(!actions.stampRequired), company });
  const [gateFailed, setGateFailed] = useState(false);
  const open = (tr: Transition) => {
    setGateFailed(false);
    if (gate.show === "signature") setNeedsSignature(true);
    else if (gate.show === "stamp") setNeedsStamp(true);
    else if (gate.show === "actionForm") setAsking(tr);
    else if (gate.show === "unavailable") setGateFailed(true);
  };

  const none = !actions.pickUp && !actions.returnToPool && actions.transitions.length === 0;
  if (none) return null;

  return (
    <section id="work-item-actions" className="space-y-3" aria-label={t("title")}>
      <div className="flex flex-wrap gap-3">
        {actions.transitions.map((tr) => (
          <Button
            key={tr.key}
            variant={backwardKinds.includes(tr.kind) ? "secondary" : "primary"}
            disabled={calls.pending || gate.show === "wait"}
            aria-busy={gate.show === "wait" || undefined}
            onClick={() => open(tr)}
          >
            {tr.label[locale]}
          </Button>
        ))}
        {actions.pickUp && (
          <Button disabled={calls.pending} onClick={() => void calls.send("pick-up")}>
            {t("pickUp")}
          </Button>
        )}
        {actions.returnToPool && (
          <Button variant="ghost" disabled={calls.pending} onClick={() => void calls.send("return-to-pool")}>
            {t("returnToPool")}
          </Button>
        )}
      </div>
      {(gateFailed || calls.error) && !asking && (
        <p role="alert" className="text-sm text-danger-fg">
          {gateFailed ? t("gateUnavailable") : calls.error}
        </p>
      )}
      {/* What was written for one Transition never carries over to another: a new pop-up for each. */}
      {asking && (
        <TransitionDialog key={asking.key} transition={asking} calls={calls} locale={locale} idPrefix="transition" onClose={() => setAsking(null)} />
      )}
      <SignatureRequired open={needsSignature} onOpenChange={setNeedsSignature} returnTo={`/work-items/${workItemId}`} />
      <StampRequired open={needsStamp} onOpenChange={setNeedsStamp} company={gate.show === "stamp" ? gate.company : null} />
    </section>
  );
}
