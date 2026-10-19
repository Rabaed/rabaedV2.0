"use client";

import { formatNumber, type Locale, type PackageNotReadyItem, type PackageNotReadyReason, type WorkItemRow } from "@rabaed/domain";
import { useState, type ElementType } from "react";
import { cn } from "../../lib/cn.ts";
import { Button } from "../button/button.tsx";
import { DocNo } from "../doc-no/doc-no.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Icon } from "../icon/icon.tsx";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "../overlay/dialog.tsx";

// Submit Package (RP-659 over RP-638): every not-yet-Submitted submittal of the Package at once,
// each with its own Submit, all or nothing. The pop-up lists what it Submits and asks to confirm
// (ADR 0017). When something stops it, nothing is Submitted and the pop-up lists each submittal
// the viewer sees that stops it, with why and a link to it, and says when one they don't see stops
// it too (never which); Submit then stays disabled until they have dealt with them.

export type SubmitPackageResult =
  | { ok: true; submitted: number }
  | { ok: false; reason: "package_not_ready"; notReady: PackageNotReadyItem[]; othersNotReady: boolean }
  | { ok: false; reason: string };

/** Submit Package, confirmed, as the page calls it. */
export type SubmitPackageCall = () => Promise<SubmitPackageResult>;

export type SubmitPackageLabels = {
  trigger: string;
  /** E.g. "Submit PKG-001". */
  title: (number: string) => string;
  description: string;
  /** Over the list of what it Submits, e.g. "3 submittals". */
  count: (n: string, count: number) => string;
  confirm: string;
  /** A Draft's number, which it gets on Submit. */
  numberOnSubmit: string;
  notReadyTitle: string;
  notReadyIntro: string;
  reasons: Record<PackageNotReadyReason, string>;
  /** One the viewer doesn't see stops it too. */
  othersNotReady: string;
};

export function SubmitPackageDialog({
  number,
  items,
  locale,
  labels,
  close,
  cancel,
  refusals,
  itemHref,
  linkAs: Link = "a",
  onSubmit,
}: {
  number: string;
  /** What it Submits, as the page knows it. */
  items: WorkItemRow[];
  locale: Locale;
  labels: SubmitPackageLabels;
  close: string;
  cancel: string;
  refusals: Record<string, string> & { unavailable: string };
  itemHref: (id: string) => string;
  linkAs?: ElementType;
  onSubmit: SubmitPackageCall;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [notReady, setNotReady] = useState<{ items: PackageNotReadyItem[]; others: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await onSubmit();
      if (result.ok) setOpen(false);
      else if ("notReady" in result) setNotReady({ items: result.notReady, others: result.othersNotReady });
      else setError(refusals[result.reason] ?? refusals.unavailable);
    } catch {
      setError(refusals.unavailable);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setNotReady(null);
        setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Icon name="send" />
          {labels.trigger}
        </Button>
      </DialogTrigger>
      <DialogContent title={labels.title(number)} description={labels.description} closeLabel={close} className="w-[min(36rem,calc(100%-2rem))]">
        {notReady ? (
          <section aria-labelledby="package-not-ready" role="alert" className="flex flex-col gap-2 rounded-md border border-danger bg-danger-tint p-3">
            <h3 id="package-not-ready" className="flex items-center gap-2 text-sm font-bold text-danger-fg">
              <Icon name="alert-triangle" size={16} />
              {labels.notReadyTitle}
            </h3>
            <p className="text-sm text-text">{labels.notReadyIntro}</p>
            <ul className="flex flex-col gap-1.5">
              {notReady.items.map((i) => (
                <li key={i.id} data-not-ready={i.reason} className="flex flex-col rounded-sm bg-surface px-3 py-2 text-sm">
                  <Link href={itemHref(i.id)} className={cn("flex min-w-0 items-center gap-2 font-semibold text-text hover:text-brand-fg", focusRing)}>
                    {i.documentNumber ? <DocNo value={i.documentNumber} className="font-ui font-normal text-muted" /> : <span className="text-muted">{labels.numberOnSubmit}</span>}
                    <span dir="auto" className="truncate">
                      {i.title}
                    </span>
                  </Link>
                  <span className="text-muted">{labels.reasons[i.reason]}</span>
                </li>
              ))}
            </ul>
            {notReady.others && <p className="text-sm text-text">{labels.othersNotReady}</p>}
          </section>
        ) : (
          <section aria-labelledby="package-to-submit" className="flex flex-col gap-2">
            <h3 id="package-to-submit" className="text-sm font-semibold text-text-secondary">
              {labels.count(formatNumber(items.length, locale), items.length)}
            </h3>
            <ul className="flex max-h-72 flex-col overflow-y-auto rounded-md border border-border">
              {items.map((i) => (
                <li key={i.id} className="flex min-w-0 items-center gap-2 px-3 py-2 text-sm not-first:border-t not-first:border-border-subtle">
                  {i.documentNumber ? <DocNo value={i.documentNumber} className="font-ui font-normal text-muted" /> : <span className="shrink-0 text-muted">{labels.numberOnSubmit}</span>}
                  <span dir="auto" className="truncate font-medium text-text">
                    {i.title}
                  </span>
                  <span translate="no" className="ms-auto font-ui text-caption font-semibold text-muted">
                    {i.type.code}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger-fg">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{cancel}</Button>
          </DialogClose>
          {/* Nothing is Submitted while anything stops it. */}
          <Button disabled={pending || notReady !== null} onClick={() => void submit()}>
            {labels.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
