"use client";

import { watchOutcomeNames, type Locale, type RevisionChain, type WorkItemList } from "@rabaed/domain";
import { Outcome, RevisionBanner, RevisionPicker, type RevisionBannerLabels, type RevisionNameLabels, type RevisionPickerLabels } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

/** The Revision picker's, banner's and read-only bar's words (RP-1253): "Rev n" stays untranslated with Latin digits; event dates only. */
export function useRevisionPickerLabels(): { revision: RevisionNameLabels; picker: RevisionPickerLabels; banner: RevisionBannerLabels } {
  const t = useTranslations("revision.picker");
  const revision: RevisionNameLabels = { rev: (n) => t("rev", { n }), original: t("original") };
  return {
    revision,
    picker: {
      revision,
      tooltip: t("tooltip"),
      title: t("title"),
      current: t("current"),
      submitted: (date) => t("submitted", { date }),
      closed: (date) => t("returned", { date }),
    },
    banner: {
      revision,
      viewing: (name, code) => (code ? t("viewing", { revision: name, code }) : t("viewingNoCode", { revision: name })),
      replaced: (latest) => t("replaced", { latest }),
      goTo: (latest) => t("goTo", { latest }),
    },
  };
}

/** Opens a Revision: as given (the Panel's), else its own page (the Work Item page). */
function useOpenRevision(onOpen: ((id: string) => void) | undefined): (id: string) => void {
  const router = useRouter();
  return onOpen ?? ((id) => router.push(`/work-items/${id}`));
}

type PickerProps = {
  chain: RevisionChain;
  openId: string;
  locale: Locale;
  /** The item's Type code and its outcomes on the Project: an earlier Revision's Outcome chip, as the page shows an Issued Code. */
  typeCode: string;
  outcomes: WorkItemList["filters"]["outcomes"];
  /** Opens a Revision; left out, its own page. */
  onOpen?: (id: string) => void;
};

/**
 * The one Revision picker (RP-1253, replacing RP-318's Select): the Revisions of the chain the API lists
 * for the viewer; choosing one opens it, with its own answers, Documents and history.
 */
export function WorkItemRevisionPicker({ chain, openId, locale, typeCode, outcomes, onOpen }: PickerProps) {
  const labels = useRevisionPickerLabels();
  const open = useOpenRevision(onOpen);
  return (
    <RevisionPicker
      locale={locale}
      labels={labels.picker}
      revisions={chain.revisions}
      openId={openId}
      outcome={(code) => <Outcome outcome={code} typeCode={typeCode} outcomes={outcomes} locale={locale} cancelled={watchOutcomeNames.cancelled[locale]} />}
      onOpen={open}
    />
  );
}

/** The amber banner while an earlier Revision is open (RP-1253): names and opens the latest Revision the viewer sees. */
export function WorkItemRevisionBanner({ chain, openId, locale, onOpen, className }: Omit<PickerProps, "typeCode" | "outcomes"> & { className?: string }) {
  const labels = useRevisionPickerLabels();
  const open = useOpenRevision(onOpen);
  return <RevisionBanner locale={locale} labels={labels.banner} revisions={chain.revisions} openId={openId} onOpen={open} {...(className ? { className } : {})} />;
}
