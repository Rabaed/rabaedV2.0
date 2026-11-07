"use client";

import { formatDate, formatNumber, watchOutcomeNames, type Locale, type RevisionChain, type WorkItemList } from "@rabaed/domain";
import { Outcome, RevisionBanner, RevisionPicker, type RevisionBannerLabels, type RevisionPickerLabels } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

/** The Revision picker's and banner's words (RP-1253): "Rev n" stays untranslated with Latin digits; event dates only. */
export function useRevisionPickerLabels(locale: Locale): { picker: RevisionPickerLabels; banner: RevisionBannerLabels } {
  const t = useTranslations("revision.picker");
  const name = (revisionNo: number) => (revisionNo > 0 ? t("rev", { n: formatNumber(revisionNo, locale) }) : t("original"));
  const date = (at: string) => formatDate(new Date(at), locale);
  return {
    picker: {
      name,
      tooltip: t("tooltip"),
      title: t("title"),
      current: t("current"),
      submitted: (at) => t("submitted", { date: date(at) }),
      returned: (at) => t("returned", { date: date(at) }),
    },
    banner: {
      name,
      viewing: (revision, code) => (code ? t("viewing", { revision, code }) : t("viewingNoCode", { revision })),
      replaced: (latest) => t("replaced", { latest }),
      goTo: (latest) => t("goTo", { latest }),
    },
  };
}

type PickerProps = {
  chain: RevisionChain;
  openId: string;
  locale: Locale;
  /** The item's Type code and its outcomes on the Project: an earlier Revision's Outcome chip, as the page shows an Issued Code. */
  typeCode: string;
  outcomes: WorkItemList["filters"]["outcomes"];
  /** Opens a Revision; on the Work Item page, its own page. */
  onOpen?: (id: string) => void;
};

/**
 * The one Revision picker (RP-1253, replacing RP-318's Select): the Revisions of the chain the API lists
 * for the viewer; choosing one opens it, with its own answers, Documents and history.
 */
export function WorkItemRevisionPicker({ chain, openId, locale, typeCode, outcomes, onOpen }: PickerProps) {
  const router = useRouter();
  const labels = useRevisionPickerLabels(locale);
  return (
    <RevisionPicker
      locale={locale}
      labels={labels.picker}
      revisions={chain.revisions}
      openId={openId}
      outcome={(code) => <Outcome outcome={code} typeCode={typeCode} outcomes={outcomes} locale={locale} cancelled={watchOutcomeNames.cancelled[locale]} />}
      onOpen={onOpen ?? ((id) => router.push(`/work-items/${id}`))}
    />
  );
}

/** The amber banner while an earlier Revision is open (RP-1253): names and opens the latest Revision the viewer sees. */
export function WorkItemRevisionBanner({ chain, openId, locale, onOpen, className }: Omit<PickerProps, "typeCode" | "outcomes"> & { className?: string }) {
  const router = useRouter();
  const labels = useRevisionPickerLabels(locale);
  return (
    <RevisionBanner
      locale={locale}
      labels={labels.banner}
      revisions={chain.revisions}
      openId={openId}
      onOpen={onOpen ?? ((id) => router.push(`/work-items/${id}`))}
      {...(className ? { className } : {})}
    />
  );
}
