"use client";

import { isHiddenLinkChoice, type HiddenLinkChoice, type LinkSearchResults, type LinkTarget, type Locale } from "@rabaed/domain";
import { useState, type ElementType } from "react";
import { LinkSearch, type LinkSearchLabels } from "./link-search.tsx";
import { LinkedItemRow, type LinkedItemRowLabels } from "./linked-item-row.tsx";

// The link question, `work_item_ref` (RP-293, form-engine.md part 2b): the items
// chosen, each its Document Number (left to right) and Subject, and Link search
// to choose more while the answers may change. A chosen item the viewer can't
// see comes from the API as a HiddenLinkChoice, without an id (E1, ADR 0012):
// opening it only says they may not see its details, and asks nothing of the
// API. Presentational: the page passes the Link search API and the names of the
// chosen items the viewer sees.

/** The link question's words, from the app's messages. */
export type LinkQuestionLabels = {
  /** The remove button of a chosen item, naming its Document Number. */
  remove: (number: string) => string;
  item: LinkedItemRowLabels;
  search: LinkSearchLabels;
};

/** A chosen item's number and Subject, by its id. */
export type LinkTargetNames = Readonly<Record<string, Omit<LinkTarget, "id">>>;

/** What a page gives the Form's link questions: Link search, and how a chosen item the viewer sees is named and opened. */
export type FormLinks = {
  /** The number and Subject of each chosen item the viewer sees, by id (e.g. from the item's Links). */
  targets: LinkTargetNames;
  /** The Link search API (edit mode). */
  search: (query: string, page: number) => Promise<LinkSearchResults>;
  /** Where a chosen item the viewer sees opens. */
  hrefFor: (workItemId: string) => string;
  /** Where a chosen item the viewer can't see opens, by its Document Number: the page of the item's Link to it (RP-521). */
  hiddenHrefFor?: (documentNumber: string) => string | null;
  /** The item's own id, never offered; undefined before it exists. */
  workItemId?: string;
  /** The link component, e.g. the app's `Link`. Defaults to `<a>`. */
  linkAs?: ElementType;
  /** How long Link search waits after typing, in ms. */
  debounceMs?: number;
};

type Choice = string | HiddenLinkChoice;

/** A link question's answer as chosen items; anything else is no choice. */
export const linkChoicesOf = (value: unknown): Choice[] =>
  Array.isArray(value) ? value.filter((v): v is Choice => typeof v === "string" || isHiddenLinkChoice(v)) : [];

/** One chosen item: opening it, or saying the viewer may not see it; removed while the answers may change. */
function ChosenItem({
  choice,
  name,
  labels,
  links,
  onRemove,
}: {
  choice: Choice;
  name: Omit<LinkTarget, "id"> | undefined;
  labels: LinkQuestionLabels;
  links: FormLinks;
  onRemove?: () => void;
}) {
  const Anchor = links.linkAs ?? "a";
  const shown = isHiddenLinkChoice(choice) ? choice : name;
  // A visible item the page can't name yet (not saved yet, nor picked here) has nothing to show but its id: never shown.
  if (!shown) return null;
  return (
    <LinkedItemRow
      labels={labels.item}
      documentNumber={shown.documentNumber}
      subject={shown.subject}
      href={typeof choice === "string" ? links.hrefFor(choice) : null}
      hiddenHref={typeof choice === "string" ? null : links.hiddenHrefFor?.(choice.documentNumber)}
      linkAs={Anchor}
      remove={onRemove && { label: labels.remove(shown.documentNumber), icon: "x", onRemove }}
    />
  );
}

export type LinkQuestionFieldProps = {
  /** The field's label, naming the list of chosen items. */
  label: string;
  /** The answer: chosen item ids, and HiddenLinkChoices for those the viewer can't see. */
  value: unknown;
  mode: "edit" | "read";
  locale: Locale;
  labels: LinkQuestionLabels;
  links: FormLinks;
  /** Called with the new answer (edit mode); `undefined` once nothing is chosen. */
  onChange?: (value: Choice[] | undefined) => void;
};

/**
 * A link question: its chosen items, and in edit mode Link search (named by the
 * Field's label) to choose more, never offering one already chosen or the item itself.
 */
export function LinkQuestionField({ label, value, mode, locale, labels, links, onChange }: LinkQuestionFieldProps) {
  // Items picked here, named until the page's `targets` name them.
  const [picked, setPicked] = useState<LinkTargetNames>({});
  const chosen = linkChoicesOf(value);
  const ids = chosen.filter((c): c is string => typeof c === "string");
  const set = (next: Choice[]) => onChange?.(next.length > 0 ? next : undefined);
  const keyOf = (c: Choice) => (typeof c === "string" ? c : `hidden:${c.documentNumber}`);
  return (
    <div className="flex flex-col gap-3">
      {chosen.length > 0 && (
        <ul aria-label={label} className="flex flex-col divide-y divide-border rounded-md border border-border">
          {chosen.map((c) => (
            <ChosenItem
              key={keyOf(c)}
              choice={c}
              name={typeof c === "string" ? (links.targets[c] ?? picked[c]) : undefined}
              labels={labels}
              links={links}
              onRemove={mode === "edit" ? () => set(chosen.filter((other) => keyOf(other) !== keyOf(c))) : undefined}
            />
          ))}
        </ul>
      )}
      {mode === "edit" && (
        <LinkSearch
          // A fresh search once an item is picked, rather than results that no longer offer it.
          key={ids.length}
          locale={locale}
          labels={labels.search}
          search={links.search}
          exclude={[...(links.workItemId ? [links.workItemId] : []), ...ids]}
          debounceMs={links.debounceMs}
          onPick={({ id, documentNumber, subject }) => {
            setPicked((current) => ({ ...current, [id]: { documentNumber, subject } }));
            set([...chosen, id]);
          }}
        />
      )}
    </div>
  );
}
