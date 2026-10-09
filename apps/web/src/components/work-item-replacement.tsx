"use client";

import { ReplacementActions, type ReplacementActionsLabels, type ReplacementCall } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { useRouter } from "@/i18n/navigation";

/**
 * Create replacement on the item page (RP-435), as the API offers it: on an item
 * closed with an outcome that offers a replacement. The new Draft opens at once.
 * The call carries an idempotency key, kept until it succeeds, so a double click
 * or a retry creates one.
 */
export function WorkItemReplacement({ workItemId, canCreate }: { workItemId: string; canCreate: boolean }) {
  const router = useRouter();
  const t = useTranslations("replacement");
  const key = useRef<string | null>(null);

  const create: ReplacementCall = async () => {
    key.current ??= crypto.randomUUID();
    const res = await fetch(`/api/v1/work-items/${workItemId}/replacements`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: key.current }),
    });
    if (!res.ok) {
      const { error } = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, reason: error ?? "unavailable" };
    }
    key.current = null;
    const { id } = (await res.json()) as { id: string };
    router.push(`/work-items/${id}`);
    return { ok: true };
  };

  const labels: ReplacementActionsLabels = {
    section: t("section"),
    createIntro: t("createIntro"),
    create: t("create"),
    refusals: {
      replacement_not_allowed: t("refusals.replacement_not_allowed"),
      project_closed: t("refusals.project_closed"),
      not_found: t("refusals.not_found"),
      idempotency_key_reused: t("refusals.idempotency_key_reused"),
      unavailable: t("refusals.unavailable"),
    },
  };

  return <ReplacementActions labels={labels} canCreate={canCreate} onCreate={create} />;
}
