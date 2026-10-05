"use client";

import type { CounterPreview, CounterStart, CounterStartRequest, CounterValues, Locale, NumberingCounter } from "@rabaed/domain";
import { NumberingCounters, type ChoiceOption, type CounterCall } from "@rabaed/ui";
import { useLocale } from "next-intl";
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
}) {
  const { projectId, ...lists } = props;
  const locale = useLocale() as Locale;
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

  return <NumberingCounters locale={locale} {...lists} preview={preview} onSetStart={onSetStart} />;
}
