"use client";

import type { CounterPreview, CounterStart, CounterStartRequest, CounterValues, Locale, NumberingCounter } from "@rabaed/domain";
import { NumberingCounters, type ChoiceOption, type CountedValues, type CounterCall, type NumberingCountersLabels } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { useCallback } from "react";
import { useRouter } from "@/i18n/navigation";

/** The API's answer as a CounterCall: the body, or the refusal's code. */
async function answer<T>(res: Response): Promise<CounterCall<T>> {
  if (res.ok) return { ok: true, value: (await res.json()) as T };
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, reason: body.error ?? "unavailable" };
}

/**
 * Project Settings → Numbering, for Project Admins: the counters and their
 * starting numbers (RP-315). Calls the API through the web's /api proxy and
 * refreshes the page's counters after a starting number is set.
 */
export function NumberingCountersSection(props: {
  projectId: string;
  counters: NumberingCounter[];
  workItemTypes: { code: string; name: { en: string; ar: string } }[];
  participants: ChoiceOption[];
  trades: ChoiceOption[];
  locations: ChoiceOption[];
  /** Per Work Item Type code, what the pattern in effect for it counts by. */
  countedBy: Record<string, CountedValues>;
}) {
  const { projectId, ...lists } = props;
  const locale = useLocale() as Locale;
  const t = useTranslations("numbering.counters");
  const router = useRouter();
  const base = `/api/v1/projects/${encodeURIComponent(projectId)}/numbering`;

  const preview = useCallback(
    async (values: CounterValues) => {
      const query = new URLSearchParams({ workItemType: values.workItemType });
      if (values.participantId) query.set("participantId", values.participantId);
      if (values.tradeId) query.set("tradeId", values.tradeId);
      if (values.locationId) query.set("locationId", values.locationId);
      return answer<CounterPreview>(await fetch(`${base}/counter?${query}`));
    },
    [base],
  );

  const onSetStart = useCallback(
    async (request: CounterStartRequest) => {
      const result = await answer<CounterStart>(
        await fetch(`${base}/counters/start`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        }),
      );
      if (result.ok) router.refresh();
      return result;
    },
    [base, router],
  );

  const labels: NumberingCountersLabels = {
    title: t("title"),
    intro: t("intro"),
    counter: t("counter"),
    lastNumber: t("lastNumber"),
    state: t("state"),
    none: t("none"),
    inUse: t("inUse"),
    startsAt: (n) => t("startsAt", { n }),
    startTitle: t("startTitle"),
    startIntro: t("startIntro"),
    type: t("type"),
    participant: t("participant"),
    trade: t("trade"),
    location: t("location"),
    notCounted: t("notCounted"),
    startingNumber: t("startingNumber"),
    next: t("next"),
    used: (n) => t("used", { n }),
    save: t("save"),
    saved: t("saved"),
    refusals: {
      participant_required: t("refusals.participant_required"),
      trade_required: t("refusals.trade_required"),
      location_required: t("refusals.location_required"),
      value_not_found: t("refusals.value_not_found"),
      type_not_found: t("refusals.type_not_found"),
      counter_used: t("refusals.counter_used"),
      project_closed: t("refusals.project_closed"),
      not_found: t("refusals.not_found"),
      invalid: t("refusals.invalid"),
      unavailable: t("refusals.unavailable"),
    },
  };
  return <NumberingCounters locale={locale} labels={labels} {...lists} preview={preview} onSetStart={onSetStart} />;
}
