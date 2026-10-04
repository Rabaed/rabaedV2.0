"use client";

import { formatNumber, type LinkSearchResults, type LinkTarget, type Locale } from "@rabaed/domain";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "../../lib/cn.ts";
import { Button } from "../button/button.tsx";
import { focusRing, textBox } from "../form/control-styles.ts";
import { useFieldControl, type FieldControlProps } from "../form/field.tsx";
import { DocNo } from "../doc-no/doc-no.tsx";
import { Icon } from "../icon/icon.tsx";

// Link search (form-engine.md part 2b; visibility.md "Link search"): a search
// box, and the items whose Document Number or Subject contain what was typed,
// to pick one to link. Used by the Links System Field and the link question
// (`work_item_ref`). Presentational: the page passes `search`, which calls the
// Link search API; the API alone decides what may be offered (Submitted items
// the Member sees, in the same Project), and says nothing of anything else.

const copy = {
  en: {
    label: "Find an item to link",
    hint: "Type part of a Document Number or Subject.",
    results: "Search results",
    searching: "Searching…",
    noMatch: "No items match.",
    offered: "Only Submitted items you can see in this Project can be linked.",
    failed: "Couldn't search. Try again.",
    more: "Show more",
    count: (n: number, more: boolean) => `${n === 1 ? "1 item" : `${formatNumber(n, "en")} items`}${more ? ", more below" : ""}`,
  },
  ar: {
    label: "ابحث عن بند لربطه",
    hint: "اكتب جزءًا من رقم المستند أو الموضوع.",
    results: "نتائج البحث",
    searching: "جارٍ البحث…",
    noMatch: "لا توجد بنود مطابقة.",
    offered: "يمكن ربط البنود المقدَّمة التي تراها في هذا المشروع فقط.",
    failed: "تعذّر البحث. حاول مرة أخرى.",
    more: "عرض المزيد",
    // Arabic counts: one, two (dual), 3–10 (plural), 11 and more (singular accusative).
    count: (n: number, more: boolean) =>
      `${
        n === 1 ? "بند واحد" : n === 2 ? "بندان" : n <= 10 ? `${formatNumber(n, "ar")} بنود` : `${formatNumber(n, "ar")} بندًا`
      }${more ? "، والمزيد أدناه" : ""}`,
  },
} satisfies Record<Locale, unknown>;

export type LinkSearchProps = {
  locale: Locale;
  /**
   * Searches for `query` (trimmed, never empty) and returns that page (from 1)
   * of the Link search API's results.
   */
  search: (query: string, page: number) => Promise<LinkSearchResults>;
  /** Called with the item the Member picks. */
  onPick: (link: LinkTarget) => void;
  /** Ids not to offer: items already linked, and the item itself. */
  exclude?: readonly string[];
  /** How long to wait after typing before searching, in ms. */
  debounceMs?: number;
  /** The search box's id; inside a Field, the Field's. */
  id?: string;
  className?: string;
};

type Found =
  | { state: "idle" }
  | { state: "searching"; links: LinkTarget[] }
  | { state: "found"; links: LinkTarget[]; nextPage: number | null }
  | { state: "failed" };

/**
 * A search box and its results, each an item's Document Number (left to right)
 * and Subject, to pick one. In a Field (a link question), the Field's label names
 * the box; on its own, it shows its own label.
 */
export function LinkSearch({ locale, search, onPick, exclude = [], debounceMs = 250, id: idProp, className }: LinkSearchProps) {
  const text = copy[locale];
  const generated = useId();
  const control = useFieldControl<FieldControlProps>({ id: idProp });
  const id = control.id ?? `link-search${generated.replaceAll(":", "")}`;
  const hintId = `${id}-hint`;
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found>({ state: "idle" });
  // Only the latest search may show its answer: an earlier one can arrive late.
  const latest = useRef(0);

  const run = async (q: string, page: number, before: LinkTarget[]) => {
    const ticket = ++latest.current;
    setFound({ state: "searching", links: before });
    try {
      const results = await search(q, page);
      if (ticket === latest.current) setFound({ state: "found", links: [...before, ...results.links], nextPage: results.nextPage });
    } catch {
      if (ticket === latest.current) setFound({ state: "failed" });
    }
  };

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      latest.current++;
      setFound({ state: "idle" });
      return;
    }
    const timer = setTimeout(() => void run(q, 1, []), debounceMs);
    return () => clearTimeout(timer);
    // `run` changes every render; a new query (or wait) is what starts a search.
  }, [query, debounceMs]);

  const excluded = new Set(exclude);
  const links = found.state === "found" || found.state === "searching" ? found.links.filter((l) => !excluded.has(l.id)) : [];
  const nextPage = found.state === "found" ? found.nextPage : null;

  let status = "";
  if (found.state === "searching" && found.links.length === 0) status = text.searching;
  else if (found.state === "found") status = links.length === 0 && !nextPage ? `${text.noMatch} ${text.offered}` : text.count(links.length, !!nextPage);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {!control.labelId && (
        <label htmlFor={id} className="text-body font-medium text-text">
          {text.label}
        </label>
      )}
      <div className="relative">
        <Icon name="search" size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          id={id}
          type="search"
          autoComplete="off"
          className={cn(textBox, "h-9 ps-8")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-describedby={[control["aria-describedby"], hintId].filter(Boolean).join(" ")}
          disabled={control.disabled}
          readOnly={control.readOnly}
          required={control.required}
          aria-invalid={control["aria-invalid"]}
        />
      </div>
      <p id={hintId} className="text-sm text-muted">
        {text.hint}
      </p>
      <p role="status" className={cn("text-sm text-muted", !status && "sr-only")}>
        {status}
      </p>
      {found.state === "failed" && (
        <p role="alert" className="text-sm text-danger">
          {text.failed}
        </p>
      )}
      {links.length > 0 && (
        <ul aria-label={text.results} className="flex flex-col divide-y divide-border rounded-sm border border-border bg-surface">
          {links.map((link) => (
            <li key={link.id}>
              <button
                type="button"
                className={cn(
                  "flex min-h-11 w-full flex-col items-start gap-0.5 px-3 py-2 text-start hover:bg-ghost-hover active:bg-ghost-press",
                  focusRing,
                )}
                onClick={() => onPick(link)}
              >
                <DocNo value={link.documentNumber} className="text-sm text-text" />
                <span className="text-body text-text">{link.subject}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {nextPage !== null && (
        <Button variant="secondary" size="sm" className="self-start pointer-coarse:min-h-11" onClick={() => void run(query.trim(), nextPage, found.state === "found" ? found.links : [])}>
          {text.more}
        </Button>
      )}
    </div>
  );
}
