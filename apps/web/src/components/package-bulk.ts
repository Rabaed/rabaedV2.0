"use client";

import { bulkStopReasons, type BulkStop, type WorkItemDetail } from "@rabaed/domain";
import type { BulkStopped, BulkTakeResult, PackageBulkLabels, PackageBulkProps } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useActionFormLabels } from "@/lib/form-labels";

/** Reasons a bulk Transition may name beyond the ones the API's types list now: RP-85's missing Signature. */
const laterReasons = ["no_signature"] as const;

/** Bulk Transitions' words, from the app's messages (packages.bulk). */
function useBulkLabels(): PackageBulkLabels {
  const t = useTranslations("packages.bulk");
  const say = (key: string) => t(key);
  const keys = <K extends string>(prefix: string, list: readonly K[]) => Object.fromEntries(list.map((k) => [k, say(`${prefix}.${k}`)])) as Record<K, string>;
  return {
    bar: t("bar"),
    hint: t("hint"),
    selected: (n) => t("selected", { n }),
    transitions: t("transitions"),
    noneShared: t("noneShared"),
    clear: t("clear"),
    selectAll: t("selectAll"),
    selectRow: (subject) => t("selectRow", { subject }),
    description: (_n, count) => t("description", { count }),
    appliesTo: t("appliesTo"),
    noNumber: t("noNumber"),
    loading: t("loading"),
    assignTo: t("assignTo"),
    assignToHelp: t("assignToHelp"),
    assignToPool: t("assignToPool"),
    formInvalid: t("formInvalid"),
    stoppedTitle: t("stoppedTitle"),
    stoppedBy: t("stoppedBy"),
    reasons: keys("reasons", [...bulkStopReasons, ...laterReasons, "unknown"] as const),
    refusals: keys("refusals", ["unavailable", "not_found", "idempotency_key_reused", "not_confirmed"] as const),
  };
}

/**
 * Bulk Transitions on the Package page (RP-661) through the RP-646 API: the Action Form and
 * "Assign to" read from the first selected item's own Transition (every selected one shares its
 * Action Form), then one `POST /v1/work-items/bulk-transitions` for all. Refused, its 409 names
 * the item that stopped it; its reason passes as the API gives it, also one this page doesn't
 * list yet, which the pop-up words as a sentence. After it, or when something moved under us,
 * the page reads the Package again.
 */
export function usePackageBulkCalls(): PackageBulkProps {
  const router = useRouter();
  const labels = useBulkLabels();
  const actionFormLabels = useActionFormLabels();
  return {
    labels,
    actionFormLabels,
    loadForm: async (transition, workItemId) => {
      const res = await fetch(`/api/v1/work-items/${workItemId}`);
      if (!res.ok) return null;
      const detail = (await res.json()) as WorkItemDetail;
      const offered = detail.actions.transitions.find((t) => t.key === transition);
      if (!offered) return null;
      return { actionForm: offered.actionForm, ...(offered.assignTo ? { assignTo: offered.assignTo } : {}) };
    },
    onTake: async (request): Promise<BulkTakeResult> => {
      const res = await fetch("/api/v1/work-items/bulk-transitions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      if (res.ok) {
        router.refresh();
        return { ok: true };
      }
      // `stoppedBy.reason` is read as a string: a reason added later (RP-85's `no_signature`) still reaches the pop-up.
      const body = (await res.json().catch(() => ({}))) as { error?: string; stoppedBy?: Omit<BulkStop, "reason"> & { reason: string } };
      if (res.status === 404 || res.status === 409) router.refresh();
      if (body.error === "bulk_refused" && body.stoppedBy) return { ok: false, reason: "bulk_refused", stoppedBy: body.stoppedBy satisfies BulkStopped };
      return { ok: false, reason: body.error ?? "unavailable" };
    },
  };
}
