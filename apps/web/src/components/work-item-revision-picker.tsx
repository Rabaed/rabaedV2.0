"use client";

import type { Locale, RevisionChain } from "@rabaed/domain";
import { RevisionPicker } from "@rabaed/ui";
import { useRouter } from "@/i18n/navigation";

/**
 * The Revision drop-down beside the Document Number (RP-318): the Revisions of
 * the chain the API lists for the viewer; choosing one opens its own page, with
 * its own answers, Documents and history.
 */
export function WorkItemRevisionPicker({ chain, workItemId, locale }: { chain: RevisionChain; workItemId: string; locale: Locale }) {
  const router = useRouter();
  return (
    <RevisionPicker locale={locale} revisions={chain.revisions} currentId={workItemId} onOpen={(id) => router.push(`/work-items/${id}`)} />
  );
}
