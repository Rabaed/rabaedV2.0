"use client";

import type { LinkSearchResults, LinkTarget, Locale, WorkItemLink } from "@rabaed/domain";
import { useId, useState, type ElementType, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { IconButton } from "../button/button.tsx";
import { focusRing } from "../form/control-styles.ts";
import { DocNo } from "../doc-no/doc-no.tsx";
import { Icon } from "../icon/icon.tsx";
import { LinkSearch } from "./link-search.tsx";

// The Links System Field, below the Form (form-engine.md part 2b; visibility.md
// E1): every Link of the item, each the other item's Document Number and
// Subject. One the viewer can see opens it; one they can't comes without an id,
// so opening it only says they may not see its details, and asks nothing of the
// API. While the raiser's Company may change them (until Submit), free Links are
// added with Link search and removed here. A link question's Links (RP-293) are
// listed under the question's label, and removed by changing its answer.
// Presentational: the page passes the API's Links and does the adding and removing.

const copy = {
  en: {
    title: "Links",
    none: "No Links yet.",
    hidden: "You are not allowed to see the details of this item.",
    remove: (number: string) => `Remove the Link to ${number}`,
  },
  ar: {
    title: "الروابط",
    none: "لا توجد روابط بعد.",
    hidden: "غير مسموح لك برؤية تفاصيل هذا البند.",
    // The Document Number sits in a left-to-right isolate (⁦, ended by ⁩).
    remove: (number: string) => `إزالة الربط مع ⁦${number}⁩`,
  },
} satisfies Record<Locale, unknown>;

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

/** One Link: the other item's Document Number and Subject, opening it, or saying the viewer may not see it. */
function LinkRow({
  link,
  locale,
  removable,
  pending,
  onRemove,
  hrefFor,
  linkAs: Anchor,
}: {
  link: WorkItemLink;
  locale: Locale;
  removable: boolean;
  pending: boolean;
  onRemove: (link: WorkItemLink) => void;
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
      <DocNo value={link.documentNumber} className="text-sm text-text" />
      <span className="text-body text-text">
        <bdi>{link.subject}</bdi>
      </span>
    </>
  );
  return (
    <li className="flex flex-col">
      <div className="flex items-center gap-1 pe-1">
        {link.workItemId ? (
          <Anchor href={hrefFor(link.workItemId)} className={target}>
            {label}
          </Anchor>
        ) : (
          // No id for an item the viewer can't see: opening it only explains why.
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
        {!link.workItemId && <Icon name="lock" size={16} label={text.hidden} className="shrink-0 text-muted" />}
        {removable && (
          <IconButton label={text.remove(link.documentNumber)} size="sm" disabled={pending} onClick={() => onRemove(link)}>
            <Icon name="trash" size={16} />
          </IconButton>
        )}
      </div>
      {!link.workItemId && (
        <p id={messageId} className={cn("px-3 pb-2 text-sm text-muted", !explained && "hidden")}>
          {text.hidden}
        </p>
      )}
    </li>
  );
}

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
    <LinkRow
      key={link.id}
      link={link}
      locale={locale}
      removable={canChange && link.kind === "related"}
      pending={pending}
      onRemove={onRemove}
      hrefFor={hrefFor}
      linkAs={linkAs}
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
