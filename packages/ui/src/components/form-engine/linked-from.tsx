"use client";

import type { LinkedFromItem, Locale } from "@rabaed/domain";
import { useId, useState, type ElementType } from "react";
import { cn } from "../../lib/cn.ts";
import { focusRing } from "../form/control-styles.ts";
import { DocNo } from "../doc-no/doc-no.tsx";
import { Icon } from "../icon/icon.tsx";

// "Linked from" (form-engine.md part 2b; visibility.md E3): the Submitted items
// that link to this one, shown in the Links section below its Links. Each is the
// other item's Document Number and Subject. One the viewer can see opens it; one
// they can't comes without an id, so opening it only says they may not see its
// details, and asks nothing of the API. Read only: a Link is changed on the item
// it is on. Presentational: the page passes what the API returns.

const copy = {
  en: {
    title: "Linked from",
    none: "No Submitted item links here yet.",
    hidden: "You are not allowed to see the details of this item.",
  },
  ar: {
    title: "مرتبط من",
    none: "لا يرتبط بهذا البند أي بند مُقدَّم بعد.",
    hidden: "غير مسموح لك برؤية تفاصيل هذا البند.",
  },
} satisfies Record<Locale, unknown>;

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

/** One linking item: opening it, or saying the viewer may not see it. */
function LinkedFromRow({
  item,
  locale,
  hrefFor,
  linkAs: Anchor,
}: {
  item: LinkedFromItem;
  locale: Locale;
  hrefFor: (workItemId: string) => string;
  linkAs: ElementType;
}) {
  const text = copy[locale];
  const messageId = useId();
  const [explained, setExplained] = useState(false);
  const target = cn(
    "flex min-h-11 min-w-0 flex-1 flex-col items-start gap-0.5 rounded-sm px-3 py-2 text-start hover:bg-ghost-hover active:bg-ghost-press",
    focusRing,
  );
  const label = (
    <>
      <DocNo value={item.documentNumber} className="text-sm text-text" />
      <span className="text-body text-text">
        <bdi>{item.subject}</bdi>
      </span>
    </>
  );
  return (
    <li className="flex flex-col">
      <div className="flex items-center gap-1 pe-1">
        {item.workItemId ? (
          <Anchor href={hrefFor(item.workItemId)} className={target}>
            {label}
          </Anchor>
        ) : (
          <button
            type="button"
            className={target}
            aria-expanded={explained}
            aria-controls={messageId}
            onClick={() => setExplained((open) => !open)}
          >
            {label}
          </button>
        )}
        {!item.workItemId && <Icon name="lock" size={16} label={text.hidden} className="shrink-0 text-muted" />}
      </div>
      {!item.workItemId && (
        <p id={messageId} className={cn("px-3 pb-2 text-sm text-muted", !explained && "hidden")}>
          {text.hidden}
        </p>
      )}
    </li>
  );
}

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
            <LinkedFromRow key={item.workItemId ?? `${item.documentNumber}-${i}`} item={item} locale={locale} hrefFor={hrefFor} linkAs={linkAs} />
          ))}
        </ul>
      )}
    </div>
  );
}
