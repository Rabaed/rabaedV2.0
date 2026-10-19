"use client";

import { backwardKinds, type Locale, type WorkItemActions as Actions } from "@rabaed/domain";
import { Badge, Button, cn } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { StampRequired, useMyCompanyRead } from "@/components/company-stamp";
import { SignatureRequired } from "@/components/signature";
import { TransitionDialog, useWorkItemCalls } from "@/components/transition-dialog";
import { loaded, transitionGate } from "@/lib/transition-gate";

type Transition = Actions["transitions"][number];

/** The phone's bar: fixed to the bottom of the screen, the page's gutter wide (RP-630). */
const phoneBarClass =
  // eslint-disable-next-line rabaed/no-avoid-terms -- CSS env() name
  "max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-20 max-md:border-t max-md:border-border max-md:bg-surface max-md:px-4 max-md:pt-3 max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-md:shadow-lg";
/** Its buttons share the row, each at least a thumb's height; a long label wraps. */
const phoneButton = "max-md:h-auto max-md:min-h-11 max-md:min-w-0 max-md:flex-1 max-md:basis-0 max-md:px-2 max-md:text-sm max-md:leading-tight max-md:whitespace-normal";

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
  phoneBar = false,
}: {
  workItemId: string;
  actions: Actions;
  locale: Locale;
  /** Below `md`, a bar fixed to the bottom of the screen, its buttons in one row in reach of a thumb (a Snag List item, RP-630). */
  phoneBar?: boolean;
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
  // The code a checklist proposes (RP-86, ADR 0025) is the one marked; the other codes stay offered.
  const proposing = actions.transitions.some((tr) => tr.proposed);

  return (
    <section id="work-item-actions" className={cn("space-y-3", phoneBar && phoneBarClass)} aria-label={t("title")}>
      <div className={cn("flex flex-wrap gap-3", phoneBar && "max-md:flex-nowrap max-md:gap-2")}>
        {actions.transitions.map((tr) => (
          <Button
            key={tr.key}
            variant={backwardKinds.includes(tr.kind) || (proposing && tr.checklists && !tr.proposed) ? "secondary" : "primary"}
            disabled={calls.pending || gate.show === "wait"}
            aria-busy={gate.show === "wait" || undefined}
            onClick={() => open(tr)}
            className={cn(phoneBar && phoneButton)}
          >
            {tr.label[locale]}
            {tr.proposed && <Badge tone="neutral">{t("proposed")}</Badge>}
          </Button>
        ))}
        {actions.pickUp && (
          <Button disabled={calls.pending} onClick={() => void calls.send("pick-up")} className={cn(phoneBar && phoneButton)}>
            {t("pickUp")}
          </Button>
        )}
        {actions.returnToPool && (
          <Button variant="ghost" disabled={calls.pending} onClick={() => void calls.send("return-to-pool")} className={cn(phoneBar && phoneButton)}>
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
        <TransitionDialog
          key={asking.key}
          transition={asking}
          calls={calls}
          locale={locale}
          recommendedCode={actions.recommendedCode}
          idPrefix="transition"
          onClose={() => setAsking(null)}
        />
      )}
      <SignatureRequired open={needsSignature} onOpenChange={setNeedsSignature} returnTo={`/work-items/${workItemId}`} />
      <StampRequired open={needsStamp} onOpenChange={setNeedsStamp} company={gate.show === "stamp" ? gate.company : null} />
    </section>
  );
}
