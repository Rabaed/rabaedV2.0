"use client";

import { formatNumber, type BilingualText, type Locale, type WorkItemRow } from "@rabaed/domain";
import { useEffect, useState } from "react";
import { cn } from "../../lib/cn.ts";
import { Button } from "../button/button.tsx";
import { DocNo } from "../doc-no/doc-no.tsx";
import { Checkbox } from "../form/checkbox.tsx";
import { Field } from "../form/field.tsx";
import { Input } from "../form/input.tsx";
import { Select } from "../form/select.tsx";
import { Icon } from "../icon/icon.tsx";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "../overlay/dialog.tsx";
import { StagePill } from "../status/stage-pill.tsx";
import { stageColour } from "../status/stage-colour.ts";

// Add items (RP-659 over RP-636): the owner picks from their own Company's submittals they see
// (Drafts, items at internal review, Submitted ones), with a search and a Trade filter. One already
// in another Package is marked and can't be picked: a submittal is in at most one. The API checks
// each again and refuses what it doesn't offer with one answer.

/** The owner's own submittals matching a search and a Trade (null: all Trades), as the List gives them; null when it can't be read. */
export type PackageItemSearch = (query: { q: string; trade: string | null }) => Promise<WorkItemRow[] | null>;

export type AddPackageItemsLabels = {
  trigger: string;
  title: string;
  description: string;
  search: string;
  searchPlaceholder: string;
  trade: string;
  allTrades: string;
  loading: string;
  noResults: string;
  /** The submittals found, as a list's name. */
  results: string;
  /** Marks one already in another Package, e.g. "In PKG-002". */
  inOther: (number: string) => string;
  inThis: string;
  /** A row's checkbox, e.g. "Choose Floor tiles". */
  choose: (subject: string) => string;
  /** The add button, e.g. "Add 2". */
  add: (n: string, count: number) => string;
  numberOnSubmit: string;
};

const searchDelayMs = 250;

export function AddPackageItemsDialog({
  packageId,
  trades,
  locale,
  labels,
  close,
  cancel,
  refusals,
  search,
  onAdd,
}: {
  packageId: string;
  trades: { id: string; code: string; name: BilingualText }[];
  locale: Locale;
  labels: AddPackageItemsLabels;
  close: string;
  cancel: string;
  refusals: Record<string, string> & { unavailable: string };
  search: PackageItemSearch;
  onAdd: (workItemIds: string[]) => Promise<{ ok: true } | { ok: false; reason: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [trade, setTrade] = useState<string | null>(null);
  const [rows, setRows] = useState<WorkItemRow[] | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setRows(null);
    const timer = setTimeout(() => {
      search({ q: q.trim(), trade })
        .then((found) => {
          if (!current) return;
          if (found === null) setError(refusals.unavailable);
          setRows(found ?? []);
        })
        .catch(() => current && (setError(refusals.unavailable), setRows([])));
    }, searchDelayMs);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [open, q, trade, search, refusals.unavailable]);

  const n = chosen.size;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setChosen(new Set());
        setError(null);
        if (!next) {
          setQ("");
          setTrade(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Icon name="plus" />
          {labels.trigger}
        </Button>
      </DialogTrigger>
      <DialogContent title={labels.title} description={labels.description} closeLabel={close} className="w-[min(40rem,calc(100%-2rem))]">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <Field label={labels.search}>
            <Input type="search" value={q} placeholder={labels.searchPlaceholder} onChange={(e) => setQ(e.target.value)} />
          </Field>
          <Field label={labels.trade}>
            <Select
              value={trade ?? "all"}
              onValueChange={(v) => setTrade(v === "all" ? null : v)}
              options={[{ value: "all", label: labels.allTrades }, ...trades.map((t) => ({ value: t.id, label: `${t.name[locale]} (${t.code})` }))]}
            />
          </Field>
        </div>
        <div aria-live="polite" className="min-h-40">
          {rows === null ? (
            <p className="py-6 text-center text-sm text-muted">{labels.loading}</p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">{labels.noResults}</p>
          ) : (
            <ul aria-label={labels.results} className="flex max-h-80 flex-col overflow-y-auto rounded-md border border-border">
              {rows.map((row) => {
                const taken = row.package !== undefined;
                const id = `add-${row.id}`;
                return (
                  <li key={row.id} data-taken={taken ? "" : undefined} className={cn("flex min-w-0 items-center gap-3 px-3 py-2 text-sm not-first:border-t not-first:border-border-subtle", taken && "bg-surface-subtle")}>
                    <Checkbox
                      id={id}
                      aria-label={labels.choose(row.title)}
                      disabled={taken}
                      checked={chosen.has(row.id)}
                      onCheckedChange={(on) => {
                        const next = new Set(chosen);
                        if (on === true) next.add(row.id);
                        else next.delete(row.id);
                        setChosen(next);
                      }}
                    />
                    <label htmlFor={id} className={cn("flex min-w-0 flex-1 flex-col", taken ? "text-muted" : "cursor-pointer")}>
                      <span dir="auto" className="truncate font-medium text-text">
                        {row.title}
                      </span>
                      <span className="flex items-center gap-2 text-caption text-muted">
                        {row.documentNumber ? <DocNo value={row.documentNumber} className="font-ui font-normal" /> : <span>{labels.numberOnSubmit}</span>}
                        <span translate="no" className="font-ui font-semibold">
                          {row.type.code}
                        </span>
                        <span>{row.trade.name[locale]}</span>
                      </span>
                    </label>
                    {taken ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-caption font-semibold text-muted">
                        <Icon name="packages" size={13} />
                        {row.package!.id === packageId ? labels.inThis : labels.inOther(row.package!.number)}
                      </span>
                    ) : (
                      <StagePill stage={stageColour(row.stage)} label={row.stage.name[locale]} locale={locale} className="shrink-0 rounded-[7px]" />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger-fg">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{cancel}</Button>
          </DialogClose>
          <Button
            disabled={pending || n === 0}
            onClick={async () => {
              setPending(true);
              setError(null);
              try {
                const result = await onAdd([...chosen]);
                if (result.ok) setOpen(false);
                else setError(refusals[result.reason] ?? refusals.unavailable);
              } catch {
                setError(refusals.unavailable);
              } finally {
                setPending(false);
              }
            }}
          >
            {labels.add(formatNumber(n, locale), n)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
