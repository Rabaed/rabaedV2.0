"use client";

import type { LinkSearchResults, LinkTarget, Locale, WorkItemLink } from "@rabaed/domain";
import { useId, type ElementType, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { LinkSearch } from "./link-search.tsx";
import { LinkedItemRow } from "./linked-item-row.tsx";

// The Links System Field, below the Form (form-engine.md part 2b; visibility.md
// E1): every Link of the item, each the other item's Document Number and
// Subject. One the viewer can see opens it; one they can't comes without an id,
// so opening it only says they may not see its details, and asks nothing of the
// API. While the raiser's Company may change them (until Submit), free Links are
// added with Link search and removed here. A link question's Links (RP-293) are
// listed under the question's label, and removed by changing its answer.
// Presentational: the page passes the API's Links and does the adding and removing.

/* eslint-disable rabaed/no-ui-translations -- existing labels, still to move to the app's messages (RP-362 retro) */
const copy = {
  en: {
    title: "Links",
    none: "No Links yet.",
    remove: (number: string) => `Remove the Link to ${number}`,
  },
  ar: {
    title: "الروابط",
    none: "لا توجد روابط بعد.",
    // The Document Number sits in a left-to-right isolate (\u2066, ended by \u2069).
    remove: (number: string) => `إزالة الربط مع \u2066${number}\u2069`,
  },
} satisfies Record<Locale, unknown>;
/* eslint-enable rabaed/no-ui-translations */

export type LinksSectionProps = {
  locale: Locale;
  /** The item's Links, as the Links API returns them for the viewer. */
  links: readonly WorkItemLink[];
  /** Free Links may be added and removed now (the raiser's Company, until Submit). */
  canChange: boolean;
  /** The item's own id, never offered by the picker. */
  workItemId: string;
  /** The Link search API, for the picker. */
  search: (query: string, page: number) => Promise<LinkSearchResults>;
  /** The Member picked an item to link. */
  onAdd: (target: LinkTarget) => void;
  /** The Member removes a free Link. */
  onRemove: (link: WorkItemLink) => void;
  /** Where a linked item the viewer can see opens. */
  hrefFor: (workItemId: string) => string;
  /** The link component, e.g. the app's `Link`, so navigation stays client-side. Defaults to `<a>`. */
  linkAs?: ElementType;
  /** A link question's label by its field key, to list its Links under (RP-293). */
  questionLabels?: Readonly<Record<string, string>>;
  /** An add or a removal is under way. */
  pending?: boolean;
  /** Why the last add or removal was refused, in the viewer's language. */
  message?: string | null;
  /** How long the picker waits after typing before searching, in ms. */
  debounceMs?: number;
  /** Shown after the Links, e.g. "Linked from" (RP-292). */
  children?: ReactNode;
  className?: string;
};

/**
 * The Links System Field: the item's Links, free ones first, then each link
 * question's under its label; the picker and remove while they may change.
 */
export function LinksSection({
  locale,
  links,
  canChange,
  workItemId,
  search,
  onAdd,
  onRemove,
  hrefFor,
  linkAs = "a",
  questionLabels = {},
  pending = false,
  message,
  debounceMs,
  children,
  className,
}: LinksSectionProps) {
  const text = copy[locale];
  const titleId = useId();
  const free = links.filter((l) => l.fieldKey === null);
  const byQuestion = new Map<string, WorkItemLink[]>();
  for (const l of links) if (l.fieldKey !== null) byQuestion.set(l.fieldKey, [...(byQuestion.get(l.fieldKey) ?? []), l]);
  const row = (link: WorkItemLink) => (
    <LinkedItemRow
      key={link.id}
      locale={locale}
      documentNumber={link.documentNumber}
      subject={link.subject}
      href={link.workItemId ? hrefFor(link.workItemId) : null}
      linkAs={linkAs}
      remove={
        canChange && link.kind === "related"
          ? { label: text.remove(link.documentNumber), icon: "trash", disabled: pending, onRemove: () => onRemove(link) }
          : undefined
      }
    />
  );
  const list = (items: readonly WorkItemLink[], label: string) => (
    <ul aria-label={label} className="flex flex-col divide-y divide-border rounded-md border border-border">
      {items.map(row)}
    </ul>
  );
  return (
    <section aria-labelledby={titleId} className={cn("flex flex-col gap-3", className)} data-testid="work-item-links">
      <h2 id={titleId} className="text-h6 font-semibold text-text">
        {text.title}
      </h2>
      {links.length === 0 && <p className="text-sm text-muted">{text.none}</p>}
      {free.length > 0 && list(free, text.title)}
      {[...byQuestion].map(([fieldKey, items]) => (
        <div key={fieldKey} className="flex flex-col gap-2">
          <h3 className="text-body font-medium text-text">{questionLabels[fieldKey] ?? fieldKey}</h3>
          {list(items, questionLabels[fieldKey] ?? fieldKey)}
        </div>
      ))}
      {canChange && (
        <LinkSearch
          // A fresh search once the picked item is linked, rather than results that no longer offer it.
          key={free.length}
          locale={locale}
          search={search}
          onPick={onAdd}
          exclude={[workItemId, ...free.flatMap((l) => (l.workItemId ? [l.workItemId] : []))]}
          debounceMs={debounceMs}
        />
      )}
      {message && (
        <p role="alert" className="text-sm text-danger">
          {message}
        </p>
      )}
      {children}
    </section>
  );
}
