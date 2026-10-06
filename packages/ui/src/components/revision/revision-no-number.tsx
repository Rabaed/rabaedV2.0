import { formatNumber, type Locale } from "@rabaed/domain";

// A Draft Revision has no Document Number until it first leaves Draft
// (workflow-engine.md §5.4): it reads as which Revision it is. One wording for
// the item page, the Work Item list and the Revision drop-down (RP-336).

const copy = {
  en: (no: string) => `Revision ${no}: no number yet`,
  ar: (no: string) => `المراجعة ${no}: بلا رقم بعد`,
} satisfies Record<Locale, unknown>;

export type RevisionNoNumberProps = { locale: Locale; revisionNo: number };

/** A Revision not yet numbered, by its Rev number. */
export function RevisionNoNumber({ locale, revisionNo }: RevisionNoNumberProps) {
  return <>{copy[locale](formatNumber(revisionNo, locale))}</>;
}
