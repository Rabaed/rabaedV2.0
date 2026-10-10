"use client";

import type { BilingualText, HandoverPick, HandoverStep, Locale } from "@rabaed/domain";
import { HandoverDialog } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

/** What the change does: its confirm button says so. */
export type HandoverAction = "deactivate" | "remove" | "save";

/**
 * How a change that may need Handovers ended: `done`; `refused` with a worded message
 * (nobody else can take one of the Steps, or another Company's Steps wait); or
 * `failed` with another refusal's code, for the caller to word (null when the API
 * couldn't be reached).
 */
export type HandoverOutcome = { kind: "done" } | { kind: "refused"; message: string } | { kind: "failed"; code: string | null };

/** One change: what it does, where it is sent (its body, with the picks once chosen), and who hears how it ended. */
export type HandoverRequest = {
  action: HandoverAction;
  method: "POST" | "PUT" | "DELETE";
  /** The web app's API path, e.g. `/api/v1/members/<id>/deactivate`. */
  url: string;
  body: Record<string, unknown>;
  /** How it ended; not called while the dialog asks, nor when it is closed without sending. */
  done: (outcome: HandoverOutcome) => void;
};

type RefusalBody = {
  error?: string;
  handovers?: HandoverStep[];
  step?: BilingualText;
  project?: BilingualText;
  steps?: number;
  company?: BilingualText;
};

/**
 * Handover (RP-108): a change that takes Members out of a Step Pool (deactivating
 * one, removing them from a Project, a Position or Visibility change, theirs or
 * their Participant's). `run` sends it; when the API lists Steps that need a new
 * holder (409 handover_needed), `dialog` asks who takes each, then sends it again
 * with the picks. With nobody else to take one (409 nobody_can_take), the refusal
 * names that Step and Project, the viewer's own Company's only; another Company's
 * Steps (409 other_company_handover) by how many and whose only. Other refusals
 * are the caller's to word.
 */
export function useHandover() {
  const t = useTranslations("handover");
  const locale = useLocale() as Locale;
  const [asking, setAsking] = useState<{ request: HandoverRequest; steps: HandoverStep[] } | null>(null);
  const [pending, setPending] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  function refusedMessage(body: RefusalBody): string | null {
    if (body.error === "nobody_can_take" && body.step && body.project) {
      return t("nobodyCanTake", { step: body.step[locale], project: body.project[locale] });
    }
    if (body.error === "other_company_handover" && body.steps && body.company) {
      return t("otherCompany", { count: body.steps, company: body.company[locale] });
    }
    return null;
  }

  async function attempt(request: HandoverRequest, picks?: HandoverPick[]): Promise<void> {
    setPending(true);
    setDialogError(null);
    try {
      const res = await fetch(request.url, {
        method: request.method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(picks ? { ...request.body, handovers: picks } : request.body),
      });
      if (res.ok) {
        setAsking(null);
        return request.done({ kind: "done" });
      }
      const body = (await res.json().catch(() => ({}))) as RefusalBody;
      if (body.error === "handover_needed" && body.handovers) {
        setAsking({ request, steps: body.handovers });
        // Sent with picks and still asked: something changed while they chose.
        if (picks) setDialogError(t("changed"));
        return;
      }
      setAsking(null);
      const message = refusedMessage(body);
      return request.done(message ? { kind: "refused", message } : { kind: "failed", code: body.error ?? null });
    } catch {
      setAsking(null);
      return request.done({ kind: "failed", code: null });
    } finally {
      setPending(false);
    }
  }

  // One holder: the dialog is about them, by name; several (a Participant's Visibility): each Step names its own.
  const holders = asking ? [...new Map(asking.steps.map((s) => [s.holder.id, s.holder.fullName[locale]])).values()] : [];
  const one = holders.length === 1 ? holders[0]! : null;

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
        title: one ? t("title", { name: one }) : t("titleSeveral"),
        description: one ? t(`description.${asking.request.action}`, { name: one }) : t("descriptionSeveral"),
        noNumber: t("noNumber"),
        hiddenItem: (step, project) => t("hiddenItem", { step, project }),
        ...(one ? {} : { heldBy: (name: string) => t("heldBy", { name }) }),
        newHolder: t("newHolder"),
        choose: t("choose"),
        cancel: t("cancel"),
        confirm: t(`confirm.${asking.request.action}`),
        close: t("close"),
      }}
      onConfirm={(picks) => void attempt(asking.request, picks)}
    />
  );

  return { run: (request: HandoverRequest) => attempt(request), pending, dialog };
}
