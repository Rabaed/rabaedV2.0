"use client";

import { isOpenStageCategory, type Locale, type WorkItemRow } from "@rabaed/domain";
import { useEffect, useState, type ElementType, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Button, buttonVariants } from "../button/button.tsx";
import { DocNo } from "../doc-no/doc-no.tsx";
import { Icon } from "../icon/icon.tsx";
import { Sheet, SheetContent } from "../overlay/sheet.tsx";
import { AgeDots } from "../status/age-dots.tsx";
import { stageColour } from "../status/stage-colour.ts";
import { StagePill } from "../status/stage-pill.tsx";
import { OwnerMark, tradeChipClass } from "./kanban-card.tsx";
import type { SnagListLabels } from "./snag-list.tsx";
import { placeText, type Places } from "./snag-look.ts";
import type { SnagSwipe } from "./snag-phone.tsx";
import type { SwipeAction, SwipeTone } from "./snag-swipe.ts";
import { ownerOf } from "./work-item-board.tsx";

// A Snag's detail over the List at tablet width (RP-1278; RP-1158 row 72, the Responsive Anatomy's
// Snag List at 1032 portrait): a 480 panel with a scrim, the List full width behind it. It shows the
// row the viewer already reads (nothing new is read for it, V1), and the Transitions its item offers,
// read as the phone's swipe reads them, so none is shown that the API would refuse.

type Loaded = "loading" | "failed" | SwipeAction[];

const toneVariant: Record<SwipeTone, "primary" | "secondary"> = { forward: "primary", move: "secondary", back: "secondary" };

export type SnagDetailProps = {
  /** The row whose detail is open; null when closed. */
  row: WorkItemRow | null;
  onClose: () => void;
  locale: Locale;
  labels: SnagListLabels;
  places: Places;
  itemHref: (id: string) => string;
  photoUrls: Readonly<Record<string, string>>;
  linkAs: ElementType;
  /** The item's Transitions, as the phone's cards read them; without it the detail offers none. */
  swipe?: SnagSwipe;
};

/** The detail panel: from the right in English, the left in Arabic; Escape and the scrim close it. */
export function SnagDetail({ row, onClose, ...rest }: SnagDetailProps) {
  return (
    <Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
      {row && (
        <SheetContent title={row.title} closeLabel={rest.labels.close} className="max-w-[480px] gap-5 p-5" closeClassName="pointer-coarse:size-11">
          <SnagDetailBody key={row.id} row={row} onClose={onClose} {...rest} />
        </SheetContent>
      )}
    </Sheet>
  );
}

function SnagDetailBody({ row, onClose, locale, labels, places, itemHref, photoUrls, linkAs: Link, swipe }: SnagDetailProps & { row: WorkItemRow }) {
  const [loaded, setLoaded] = useState<Loaded | null>(swipe ? "loading" : null);
  useEffect(() => {
    if (!swipe) return;
    let stale = false;
    swipe.load(row.id).then(
      (actions) => !stale && setLoaded(actions ?? "failed"),
      () => !stale && setLoaded("failed"),
    );
    return () => {
      stale = true;
    };
  }, [swipe, row.id]);
  const owner = ownerOf(row, locale, labels);
  const place = placeText(row, places, locale);
  const url = row.photo ? photoUrls[row.photo.documentId] : undefined;
  const open = isOpenStageCategory(row.stage.category);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {row.documentNumber ? (
          <DocNo value={row.documentNumber} locale={locale} className="font-ui text-[12.5px] font-semibold text-muted" />
        ) : (
          <span className="text-caption text-muted">{labels.noNumber}</span>
        )}
        <StagePill stage={stageColour(row.stage)} label={row.stage.name[locale]} locale={locale} />
        {open && row.stepAgeWeeks !== null && <AgeDots weeks={row.stepAgeWeeks} locale={locale} />}
      </div>
      {row.photo && (
        <div className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-md bg-surface-subtle text-faint ring-1 ring-border-subtle ring-inset">
          {url ? <img src={url} alt={labels.photoOf(row.title)} className="size-full object-cover" /> : <Icon name="photo" size={32} label={labels.photoOf(row.title)} />}
        </div>
      )}
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 text-[13.5px]">
        <Field term={labels.columns.type}>
          <span className="font-semibold">{row.type.name[locale]}</span>
        </Field>
        <Field term={labels.columns.trade}>
          <span className={cn("inline-flex h-[22px] items-center rounded-[6px] px-1.5 text-caption font-semibold", tradeChipClass(row.trade.code))}>{row.trade.name[locale]}</span>
        </Field>
        {place && <Field term={labels.columns.location}>{place}</Field>}
        {owner && (
          <Field term={labels.columns.with}>
            <span className="flex min-w-0 items-center gap-2">
              <OwnerMark owner={owner} solid />
              <span className="truncate">{owner.name}</span>
            </span>
          </Field>
        )}
      </dl>
      {loaded !== null && (
        <section aria-label={labels.phone.transitionsOf(row.title)} className="flex flex-wrap gap-2">
          {Array.isArray(loaded) && loaded.length > 0 ? (
            loaded.map((action) => (
              <Button
                key={action.key}
                variant={toneVariant[action.tone]}
                className="min-w-32 flex-1 pointer-coarse:min-h-11"
                onClick={() => {
                  // The page opens the Transition's pop-up: this panel closes first, so the two never trap focus together.
                  onClose();
                  swipe?.take(row.id, action.key);
                }}
              >
                {action.label[locale]}
              </Button>
            ))
          ) : (
            <p role="status" className="text-caption text-muted">
              {loaded === "loading" ? labels.phone.loadingTransitions : loaded === "failed" ? labels.phone.transitionsUnavailable : labels.phone.noTransitions}
            </p>
          )}
        </section>
      )}
      <Link href={itemHref(row.id)} className={cn(buttonVariants({ variant: "secondary" }), "self-start pointer-coarse:min-h-11")}>
        {labels.openPage}
        <Icon name="arrow-right" />
      </Link>
    </>
  );
}

function Field({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-caption text-muted">{term}</dt>
      <dd className="min-w-0 text-text">{children}</dd>
    </>
  );
}
