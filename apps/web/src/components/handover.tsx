"use client";

import type { BilingualText, HandoverPick, HandoverStep, Locale } from "@rabaed/domain";
import { HandoverDialog } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

/** The change being made: its confirm button says so. */
export type HandoverChange = "deactivate" | "remove" | "save";

/**
 * What a change that may need Handovers answered: done; refused because nobody else
 * can take one of the Steps (`message`, worded, naming it); or another refusal's
 * code, for the caller to word (null when the API couldn't be reached).
 */
export type HandoverOutcome = { ok: true } | { ok: false; message: string } | { ok: false; code: string | null };

/** One change: whose, which, how to send it (with the picks, once chosen) and who hears how it ended. */
export type HandoverRequest = {
  /** The Member the change is about, by name. */
  name: string;
  change: HandoverChange;
  send: (handovers?: HandoverPick[]) => Promise<Response>;
  /** How it ended; not called while the dialog asks, nor when it is closed without sending. */
  done: (outcome: HandoverOutcome) => void;
};

/**
 * Handover (RP-108): a change that takes a Member out of a Step Pool (deactivating
 * them, removing them from a Project, a Position or Visibility change). `run` sends
 * it; when the API lists Steps of theirs that need a new holder (409
 * handover_needed), `dialog` asks who takes each, then sends it again with the
 * picks. With nobody else to take one (409 nobody_can_take), the refusal names that
 * Step and Project, the viewer's own Company's only. Other refusals are the
 * caller's to word.
 */
export function useHandover() {
  const t = useTranslations("handover");
  const locale = useLocale() as Locale;
  const [asking, setAsking] = useState<{ request: HandoverRequest; steps: HandoverStep[] } | null>(null);
  const [pending, setPending] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  async function attempt(request: HandoverRequest, picks?: HandoverPick[]): Promise<void> {
    setPending(true);
    setDialogError(null);
    try {
      const res = await request.send(picks);
      if (res.ok) {
        setAsking(null);
        return request.done({ ok: true });
      }
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        handovers?: HandoverStep[];
        step?: BilingualText;
        project?: BilingualText;
      };
      if (body.error === "handover_needed" && body.handovers) {
        setAsking({ request, steps: body.handovers });
        // Sent with picks and still asked: something changed while they chose.
        if (picks) setDialogError(t("changed"));
        return;
      }
      setAsking(null);
      if (body.error === "nobody_can_take" && body.step && body.project) {
        return request.done({ ok: false, message: t("nobodyCanTake", { step: body.step[locale], project: body.project[locale] }) });
      }
      return request.done({ ok: false, code: body.error ?? null });
    } catch {
      setAsking(null);
      return request.done({ ok: false, code: null });
    } finally {
      setPending(false);
    }
  }

  const dialog: ReactNode = asking && (
    <HandoverDialog
      // A new list starts its picks again.
      key={asking.steps.map((s) => s.assignmentId).join()}
      open
      onOpenChange={(open) => {
        if (!open) setAsking(null);
      }}
      steps={asking.steps}
      locale={locale}
      pending={pending}
      error={dialogError}
      labels={{
        title: t("title", { name: asking.request.name }),
        description: t(`description.${asking.request.change}`, { name: asking.request.name }),
        noNumber: t("noNumber"),
        newHolder: t("newHolder"),
        choose: t("choose"),
        cancel: t("cancel"),
        confirm: t(`confirm.${asking.request.change}`),
        close: t("close"),
      }}
      onConfirm={(picks) => void attempt(asking.request, picks)}
    />
  );

  return { run: (request: HandoverRequest) => attempt(request), pending, dialog };
}
