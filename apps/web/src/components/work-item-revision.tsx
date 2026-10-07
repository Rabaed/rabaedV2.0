"use client";

import { RevisionActions, type RevisionActionsLabels, type RevisionCall } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { useRouter } from "@/i18n/navigation";

/**
 * Create Revision and Discard Revision on the item page (RP-316), as the API
 * offers them. A new Revision opens at once; a discarded one is gone for
 * everyone, so the page goes back to the list. Create carries an idempotency
 * key, kept until it succeeds, so a double click or a retry creates one.
 */
export function WorkItemRevision({
  workItemId,
  projectId,
  canCreate,
  canDiscard,
}: {
  workItemId: string;
  projectId: string;
  canCreate: boolean;
  canDiscard: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("revision");
  const key = useRef<string | null>(null);

  async function post(path: string, body: unknown) {
    const res = await fetch(`/api/v1/work-items/${workItemId}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true as const, res };
    const { error } = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false as const, reason: error ?? "unavailable" };
  }

  const create: RevisionCall = async () => {
    key.current ??= crypto.randomUUID();
    const result = await post("revisions", { idempotencyKey: key.current });
    if (!result.ok) return result;
    key.current = null;
    const { id } = (await result.res.json()) as { id: string };
    router.push(`/work-items/${id}`);
    return { ok: true };
  };

  const discard: RevisionCall = async () => {
    const result = await post("discard", {});
    if (!result.ok) return result;
    router.push(`/projects/${projectId}/work-items`);
    return { ok: true };
  };

  const labels: RevisionActionsLabels = {
    section: t("section"),
    createIntro: t("createIntro"),
    create: t("create"),
    discard: t("discard"),
    discardTitle: t("discardTitle"),
    discardIntro: t("discardIntro"),
    cancel: t("cancel"),
    close: t("close"),
    refusals: {
      revision_not_allowed: t("refusals.revision_not_allowed"),
      not_discardable: t("refusals.not_discardable"),
      project_closed: t("refusals.project_closed"),
      not_found: t("refusals.not_found"),
      idempotency_key_reused: t("refusals.idempotency_key_reused"),
      unavailable: t("refusals.unavailable"),
    },
  };

  return <RevisionActions labels={labels} canCreate={canCreate} canDiscard={canDiscard} onCreate={create} onDiscard={discard} />;
}
