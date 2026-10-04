"use client";

import { isHiddenLinkChoice, type HiddenLinkChoice, type LinkSearchResults, type LinkTarget, type Locale } from "@rabaed/domain";
import { useId, useState, type ElementType } from "react";
import { cn } from "../../lib/cn.ts";
import { IconButton } from "../button/button.tsx";
import { focusRing } from "../form/control-styles.ts";
import { DocNo } from "../doc-no/doc-no.tsx";
import { Icon } from "../icon/icon.tsx";
import { LinkSearch } from "./link-search.tsx";

// The link question, `work_item_ref` (RP-293, form-engine.md part 2b): the items
// chosen, each its Document Number (left to right) and Subject, and Link search
// to choose more while the answers may change. A chosen item the viewer can't
// see comes from the API as a HiddenLinkChoice, without an id (E1, ADR 0012):
// opening it only says they may not see its details, and asks nothing of the
// API. Presentational: the page passes the Link search API and the names of the
// chosen items the viewer sees.

const copy = {
  en: {
    hidden: "You are not allowed to see the details of this item.",
    remove: (number: string) => `Remove ${number}`,
  },
  ar: {
    hidden: "غير مسموح لك برؤية تفاصيل هذا البند.",
    // The Document Number sits in a left-to-right isolate (\u2066, ended by \u2069).
    remove: (number: string) => `إزالة \u2066${number}\u2069`,
  },
} satisfies Record<Locale, unknown>;

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
  locale,
  links,
  onRemove,
}: {
  choice: Choice;
  name: Omit<LinkTarget, "id"> | undefined;
  locale: Locale;
  links: FormLinks;
  onRemove?: () => void;
}) {
  const text = copy[locale];
  const messageId = useId();
  const [explained, setExplained] = useState(false);
  const Anchor = links.linkAs ?? "a";
  const shown = isHiddenLinkChoice(choice) ? choice : name;
  // A visible item the page can't name yet (not saved yet, nor picked here) has nothing to show but its id: never shown.
  if (!shown) return null;
  const hidden = typeof choice !== "string";
  const target = cn(
    "flex min-h-11 min-w-0 flex-1 flex-col items-start gap-0.5 rounded-sm px-3 py-2 text-start hover:bg-ghost-hover active:bg-ghost-press",
    focusRing,
  );
  const label = (
    <>
      <DocNo value={shown.documentNumber} className="text-sm text-text" />
      <span className="text-body text-text">
        <bdi>{shown.subject}</bdi>
      </span>
    </>
  );
  return (
    <li className="flex flex-col">
      <div className="flex items-center gap-1 pe-1">
        {hidden ? (
          <button type="button" className={target} aria-expanded={explained} aria-controls={messageId} onClick={() => setExplained((open) => !open)}>
            {label}
          </button>
        ) : (
          <Anchor href={links.hrefFor(choice)} className={target}>
            {label}
          </Anchor>
        )}
        {hidden && <Icon name="lock" size={16} label={text.hidden} className="shrink-0 text-muted" />}
        {onRemove && (
          <IconButton label={text.remove(shown.documentNumber)} size="sm" onClick={onRemove}>
            <Icon name="x" size={16} />
          </IconButton>
        )}
      </div>
      {hidden && (
        <p id={messageId} className={cn("px-3 pb-2 text-sm text-muted", !explained && "hidden")}>
          {text.hidden}
        </p>
      )}
    </li>
  );
}

export type LinkQuestionFieldProps = {
  /** The field's label, naming the list of chosen items. */
  label: string;
  /** The answer: chosen item ids, and HiddenLinkChoices for those the viewer can't see. */
  value: unknown;
  mode: "edit" | "read";
  locale: Locale;
  links: FormLinks;
  /** Called with the new answer (edit mode); `undefined` once nothing is chosen. */
  onChange?: (value: Choice[] | undefined) => void;
};

/**
 * A link question: its chosen items, and in edit mode Link search (named by the
 * Field's label) to choose more, never offering one already chosen or the item itself.
 */
export function LinkQuestionField({ label, value, mode, locale, links, onChange }: LinkQuestionFieldProps) {
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
              locale={locale}
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
