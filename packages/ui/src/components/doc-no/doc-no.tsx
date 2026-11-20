import { directionOf, formatNumber, type Locale, type RevisionBase, type RevisionBaseState } from "@rabaed/domain";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";

// The revision suffix (GLOSSARY.md, Revision) is fixed product wording, so every Module words it the same.
// The stored Document Number's English ` Rev n` (issued by app.take_transition, docs/workflow-engine.md) is the
// definition; this is its display wording for a separate `rev`, plus the Arabic form.
// eslint-disable-next-line rabaed/no-ui-translations -- a documented exception in packages/ui/README.md (DocNo's revision word)
const revisionWord: Record<Locale, string> = { en: "Rev", ar: "مراجعة" };

export type DocNoProps = Omit<ComponentProps<"bdi">, "children" | "dir" | "rev"> & {
  /**
   * The Document Number, built from the Project's Numbering Pattern, e.g. `TWR-MAR-CCM-0001`;
   * a Revision's is issued with its suffix, e.g. `TWR-MAR-CCM-0001 Rev 1`, and shown whole, left to right.
   */
  value: string;
} & (
    | { rev?: undefined; locale?: Locale }
    | {
        /** The revision, shown after the number: `Rev n` in English, `مراجعة n` in Arabic. */
        rev?: number | string;
        /** The language of the revision word; required with `rev`. */
        locale: Locale;
        /** Classes for the revision part alone, e.g. the Submittal Panel's brand orange. */
        revClassName?: string;
      }
  );

/**
 * A Document Number, optionally with its revision. The number is always left
 * to right and isolated from the surrounding text, so it never scrambles
 * inside an Arabic sentence; tabular digits keep numbers aligned in lists.
 * With a revision, the number and its revision are one unit isolated in the
 * locale's direction, so the revision follows the number in reading order.
 */
// The types require `locale` with `rev`; the default only keeps an untyped caller's revision visible.
export function DocNo({ value, rev, locale = "en", className, revClassName, ...props }: DocNoProps & { revClassName?: string }) {
  const classes = cn("whitespace-nowrap font-medium tabular-nums", className);
  // Browser translation would mangle an identifier.
  if (rev === undefined) {
    return (
      <bdi dir="ltr" translate="no" className={classes} {...props}>
        {value}
      </bdi>
    );
  }
  return (
    <bdi dir={directionOf(locale)} className={classes} {...props}>
      <bdi dir="ltr" translate="no">
        {value}
      </bdi>{" "}
      {revClassName ? (
        <span className={revClassName}>
          {revisionWord[locale]} {rev}
        </span>
      ) : (
        <>
          {revisionWord[locale]} {rev}
        </>
      )}
    </bdi>
  );
}

/** The reader's words for where a Revision not yet Submitted stands (RP-1314): "Draft" and "Internal Review". */
export type RevisionStateLabels = { revisionDraft: string; revisionInternalReview: string };

/** The word for `state` (RP-1314): "Draft" while it never left Draft, "Internal Review" once it has. */
export const revisionStateWord = (labels: RevisionStateLabels, state: RevisionBaseState): string =>
  state === "internal_review" ? labels.revisionInternalReview : labels.revisionDraft;

/**
 * A Revision's number before its own first Submit (RP-1300, RP-1314; owner's decisions 2026-11-13 and 2026-11-20):
 * its chain's base number, known from the start, with its revision and where it stands, "UAT01-MAR-01-0005 Rev 1 ·
 * Draft" or "UAT01-MAR-01-0005 Rev 1 · Internal Review". Its own number (base " Rev n") is issued only at that
 * Submit (ADR 0030), so until then this is what it reads.
 */
export function RevisionDraftNumber({
  base,
  revision,
  state,
  locale,
  className,
  revClassName,
  stateClassName,
}: {
  /** The chain's base number, the original's Document Number. */
  base: string;
  revision: number;
  /** The word for where it stands (`revisionStateWord`), in the reader's language. */
  state: string;
  locale: Locale;
  className?: string;
  revClassName?: string;
  stateClassName?: string;
}) {
  return (
    // Isolated in the reader's direction, as DocNo with a revision is, so "· Draft" follows the revision in any container.
    <bdi dir={directionOf(locale)} className="whitespace-nowrap">
      <DocNo value={base} rev={formatNumber(revision, locale)} locale={locale} className={className} revClassName={revClassName} />
      {" "}
      <span className={stateClassName}>· {state}</span>
    </bdi>
  );
}

/** `RevisionDraftNumber` as text, for Export and Group by: "UAT01-MAR-01-0005 Rev 1 · Internal Review". */
export const revisionDraftText = (base: string, revision: number, state: string, locale: Locale) =>
  `${base} ${revisionWord[locale]} ${formatNumber(revision, locale)} · ${state}`;

/** A List row's `baseNumber` and `baseState` as one `RevisionBase` (RP-1314); undefined for a row with neither. */
export const rowRevisionBase = (
  row: { documentNumber: string | null; baseNumber?: string | undefined; baseState?: RevisionBaseState | undefined; revisionNo: number } | undefined,
): RevisionBase | undefined =>
  row && row.documentNumber === null && row.baseNumber !== undefined
    ? { baseNumber: row.baseNumber, revisionNo: row.revisionNo, state: row.baseState ?? "draft" }
    : undefined;

/**
 * An item's number where a screen names it (the Handover dialog, the Activity Feed, the bulk pop-up, Vacancies, a
 * notification): its own, else a Revision's base number and state (RP-1314), else `noNumber` ("No number yet").
 */
export function ItemNumber({
  documentNumber,
  revisionBase,
  labels,
  locale,
  className,
  noNumber,
}: {
  documentNumber: string | null;
  revisionBase?: RevisionBase | undefined;
  labels: RevisionStateLabels;
  locale: Locale;
  /** Classes for the number, as the screen's own DocNo has them. */
  className?: string;
  /** What an item with no number at all shows: the screen's own "No number yet". */
  noNumber: ReactNode;
}) {
  if (documentNumber) return <DocNo value={documentNumber} className={className} />;
  if (revisionBase)
    return <RevisionDraftNumber base={revisionBase.baseNumber} revision={revisionBase.revisionNo} state={revisionStateWord(labels, revisionBase.state)} locale={locale} className={className} />;
  return <>{noNumber}</>;
}
