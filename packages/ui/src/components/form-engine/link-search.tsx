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

/** Link search's words, from the app's messages. A number is given already formatted for the locale, with the count itself where the wording depends on it. */
export type LinkSearchLabels = {
  label: string;
  hint: string;
  results: string;
  searching: string;
  noMatch: string;
  offered: string;
  failed: string;
  more: string;
  /** How many items were found, and whether more are below. */
  count: (n: string, count: number, more: boolean) => string;
};

export type LinkSearchProps = {
  locale: Locale;
  labels: LinkSearchLabels;
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
export function LinkSearch({ locale, labels: text, search, onPick, exclude = [], debounceMs = 250, id: idProp, className }: LinkSearchProps) {
  const generated = useId();
  const control = useFieldControl<FieldControlProps>({ id: idProp });
  const id = control.id ?? `link-search${generated.replaceAll(":", "")}`;
  const hintId = `${id}-hint`;
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found>({ state: "idle" });
  // Only the latest search may show its answer: an earlier one can arrive late.
  const latest = useRef(0);

  const run = async (q: string, page: number, before: LinkTarget[]) => {
    const searchNo = ++latest.current;
    setFound({ state: "searching", links: before });
    try {
      const results = await search(q, page);
      if (searchNo === latest.current) setFound({ state: "found", links: [...before, ...results.links], nextPage: results.nextPage });
    } catch {
      if (searchNo === latest.current) setFound({ state: "failed" });
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
  else if (found.state === "found") status = links.length === 0 && !nextPage ? `${text.noMatch} ${text.offered}` : text.count(formatNumber(links.length, locale), links.length, !!nextPage);

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
        <p role="alert" className="text-sm text-danger-fg">
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
