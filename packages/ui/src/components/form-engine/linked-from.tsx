"use client";

import type { LinkedFromItem, Locale } from "@rabaed/domain";
import { useId, type ElementType } from "react";
import { cn } from "../../lib/cn.ts";
import { LinkedItemRow } from "./linked-item-row.tsx";

// "Linked from" (form-engine.md part 2b; visibility.md E3): the Submitted items
// that link to this one, shown in the Links section below its Links. Each is the
// other item's Document Number and Subject. One the viewer can see opens it; one
// they can't comes without an id, so opening it only says they may not see its
// details, and asks nothing of the API. Read only: a Link is changed on the item
// it is on. Presentational: the page passes what the API returns.

/* eslint-disable rabaed/no-ui-translations -- existing labels, still to move to the app's messages (RP-362 retro) */
const copy = {
  en: {
    title: "Linked from",
    none: "No Submitted item links here yet.",
  },
  ar: {
    title: "مرتبط من",
    none: "لا يرتبط بهذا البند أي بند مُقدَّم بعد.",
  },
} satisfies Record<Locale, unknown>;
/* eslint-enable rabaed/no-ui-translations */

export type LinkedFromListProps = {
  locale: Locale;
  /** The Submitted items linking here, as the Linked from API returns them for the viewer. */
  items: readonly LinkedFromItem[];
  /** Where a linking item the viewer can see opens. */
  hrefFor: (workItemId: string) => string;
  /** The link component, e.g. the app's `Link`, so navigation stays client-side. Defaults to `<a>`. */
  linkAs?: ElementType;
  className?: string;
};

/** "Linked from": the Submitted items linking to this one, under its own heading in the Links section. */
export function LinkedFromList({ locale, items, hrefFor, linkAs = "a", className }: LinkedFromListProps) {
  const text = copy[locale];
  const titleId = useId();
  return (
    <div className={cn("flex flex-col gap-2", className)} data-testid="work-item-linked-from">
      <h3 id={titleId} className="text-body font-medium text-text">
        {text.title}
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{text.none}</p>
      ) : (
        <ul aria-labelledby={titleId} className="flex flex-col divide-y divide-border rounded-md border border-border">
          {items.map((item, i) => (
            // A hidden item has no id; the API lists each item once, by Document Number.
            <LinkedItemRow
              key={item.workItemId ?? `${item.documentNumber}-${i}`}
              locale={locale}
              documentNumber={item.documentNumber}
              subject={item.subject}
              href={item.workItemId ? hrefFor(item.workItemId) : null}
              linkAs={linkAs}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
