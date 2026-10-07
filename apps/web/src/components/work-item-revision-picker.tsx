"use client";

import type { Locale, RevisionChain } from "@rabaed/domain";
import { RevisionPicker } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

/**
 * The Revision drop-down beside the Document Number (RP-318): the Revisions of
 * the chain the API lists for the viewer; choosing one opens its own page, with
 * its own answers, Documents and history.
 */
export function WorkItemRevisionPicker({ chain, workItemId, locale }: { chain: RevisionChain; workItemId: string; locale: Locale }) {
  const router = useRouter();
  const t = useTranslations("workItemViews");
  const tRevision = useTranslations("revision");
  return (
    <RevisionPicker
      locale={locale}
      labels={{ label: tRevision("pickerLabel") }}
      revisions={chain.revisions}
      currentId={workItemId}
      revisionNoNumber={(revision) => t("list.revisionNoNumber", { revision })}
      onOpen={(id) => router.push(`/work-items/${id}`)}
    />
  );
}
