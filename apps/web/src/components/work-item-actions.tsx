"use client";

import { backwardKinds, type Locale, type WorkItemActions as Actions } from "@rabaed/domain";
import { Button } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { TransitionDialog, useWorkItemCalls } from "@/components/transition-dialog";

type Transition = Actions["transitions"][number];

/**
 * Exactly the buttons the viewer may press on a Work Item, as the API lists them.
 * Each Transition opens its pop-up first (`TransitionDialog`, the same one a
 * Kanban move opens); Pick up and Return to pool are taken at once.
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

  const none = !actions.pickUp && !actions.returnToPool && actions.transitions.length === 0;
  if (none) return null;

  return (
    <section className="space-y-3" aria-label={t("title")}>
      <div className="flex flex-wrap gap-3">
        {actions.transitions.map((tr) => (
          <Button
            key={tr.key}
            variant={backwardKinds.includes(tr.kind) ? "secondary" : "primary"}
            disabled={calls.pending}
            onClick={() => setAsking(tr)}
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
      {calls.error && !asking && (
        <p role="alert" className="text-sm text-danger">
          {calls.error}
        </p>
      )}
      {/* What was written for one Transition never carries over to another: a new pop-up for each. */}
      {asking && (
        <TransitionDialog key={asking.key} transition={asking} calls={calls} locale={locale} idPrefix="transition" onClose={() => setAsking(null)} />
      )}
    </section>
  );
}
