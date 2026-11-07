"use client";

import { formatNumber, workItemListHref, type Locale, type WorkItemDetail } from "@rabaed/domain";
import { DocNo } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { WorkItemPaperRef } from "@/components/work-item-paper-ref";
import { Link } from "@/i18n/navigation";

type Field = { key: string; label: string; value: ReactNode; full?: boolean };

const linkClass = "text-brand-fg underline underline-offset-4";

/**
 * The System Fields and facts the Work Item page's Details card listed (RP-1151 row 22), now in the
 * panel's Subject section (RP-1237 row 12), so nothing the page showed is lost: the Paper ref, where a
 * Duplicate came from, who raised it, and what was raised from it and from its previous Revision. Each
 * only as the item read gives it to the viewer; the counts count only what they see.
 */
export function useSubmittalPanelItemFacts(item: WorkItemDetail, locale: Locale): Field[] {
  const t = useTranslations("workItems");
  const n = (value: number) => formatNumber(value, locale);
  const typeName = (type: { code: string; name: { en: string; ar: string } }) =>
    t.has(`fields.raisedItemTypes.${type.code}`) ? t(`fields.raisedItemTypes.${type.code}`) : type.name[locale];
  const fields: Field[] = [];
  // The Paper ref (RP-639): its old paper number, never its Document Number; changed only while a Draft.
  if (item.paperRef !== null || item.actions.editPaperRef)
    fields.push({ key: "paperRef", label: t("fields.paperRef"), value: <WorkItemPaperRef workItemId={item.id} value={item.paperRef} canEdit={item.actions.editPaperRef} /> });
  // Where a Duplicate came from: the raiser's own Company only, and no time (RP-409).
  if (item.duplicatedFrom)
    fields.push({
      key: "duplicatedFrom",
      label: t("fields.duplicatedFrom"),
      value: (
        <Link href={`/work-items/${item.duplicatedFrom.workItemId}`} className={linkClass}>
          {item.duplicatedFrom.documentNumber ? <DocNo value={item.duplicatedFrom.documentNumber} /> : <bdi>{item.duplicatedFrom.subject}</bdi>}
        </Link>
      ),
    });
  fields.push({ key: "raisedBy", label: t("fields.raisedBy"), value: item.raisedBy.companyName[locale] });
  // What was raised from it (its Comments, its Snags), one line per Type, each opening the Snag List filtered to them (RP-628).
  for (const f of item.raisedItems) {
    const counts = t("fields.raisedItemCounts", { open: n(f.open), closed: n(f.closed) });
    fields.push({
      key: `raised-${f.type.code}`,
      label: typeName(f.type),
      value: (
        <span data-testid={`raised-item-counts-${f.type.code}`}>
          {item.documentNumber ? (
            <Link href={workItemListHref(item.projectId, { module: "snag_list", type: [f.type.code], raisedFrom: [item.documentNumber] })} className={linkClass}>
              {counts}
            </Link>
          ) : (
            counts
          )}
        </span>
      ),
    });
  }
  // A Revision: what its previous item in the chain left (RP-653). It never blocks the code.
  const previous = item.previousRaisedItems;
  for (const f of previous?.items ?? []) {
    const counts = t("fields.previousRaisedItemCounts", { closed: n(f.closed), open: n(f.open) });
    fields.push({
      key: `previous-${f.type.code}`,
      label: t("fields.previousRaisedItems", { type: typeName(f.type), revision: n(previous!.revisionNo) }),
      value: (
        <span data-testid={`previous-raised-item-counts-${f.type.code}`}>
          {previous!.documentNumber ? (
            <Link href={workItemListHref(item.projectId, { module: "snag_list", type: [f.type.code], raisedFrom: [previous!.documentNumber] })} className={linkClass}>
              {counts}
            </Link>
          ) : (
            counts
          )}
        </span>
      ),
    });
  }
  return fields;
}
