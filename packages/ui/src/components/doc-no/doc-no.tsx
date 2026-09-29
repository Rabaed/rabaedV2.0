import { directionOf, type Locale } from "@rabaed/domain";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.ts";

// The revision suffix (CONTEXT.md, Revision) is fixed product wording, so every Module words it the same.
const revisionWord: Record<Locale, string> = { en: "Rev", ar: "مراجعة" };

export type DocNoProps = Omit<ComponentProps<"bdi">, "children" | "dir" | "rev"> & {
  /** The Document Number, e.g. `TWR-TMC-EL-MAR-041`. */
  value: string;
} & (
    | { rev?: undefined; locale?: Locale }
    | {
        /** The revision, shown after the number: `Rev n` in English, `مراجعة n` in Arabic. */
        rev?: number | string;
        /** The language of the revision word; required with `rev`. */
        locale: Locale;
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
export function DocNo({ value, rev, locale = "en", className, ...props }: DocNoProps) {
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
      {revisionWord[locale]} {rev}
    </bdi>
  );
}
