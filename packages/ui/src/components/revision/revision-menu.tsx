"use client";

import type { Locale } from "@rabaed/domain";
import { useState } from "react";
import { cn } from "../../lib/cn.ts";
import { DocNo } from "../doc-no/doc-no.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Icon } from "../icon/icon.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../overlay/popover.tsx";

/** The Revision menu's words, from the app's messages. */
export type RevisionMenuLabels = {
  /** "Revisions you can see": names the menu. */
  title: string;
  /** "Open": marks the Revision on the page. */
  open: string;
  /** A Revision's name: "Original" (0, numbered), "Draft" (0, no number yet), "Revision 1"… */
  name: (revisionNo: number, hasNumber: boolean) => string;
  /** A Draft Revision with no number: "No number yet: Revision 1". */
  noNumber: (revisionNo: number) => string;
};

export type RevisionMenuProps = {
  locale: Locale;
  labels: RevisionMenuLabels;
  /** The chain as the API lists it (`RevisionChain.revisions`): only those the viewer may see, the original first. */
  revisions: readonly { id: string; documentNumber: string | null; revisionNo: number }[];
  /** The Revision on the page. */
  currentId: string;
  /** Opens the chosen Revision; never called for the one already open. */
  onOpen: (id: string) => void;
};

/**
 * The Work Item page's Revision pill (RP-1151, gap table rows 10–11; the owner's design): beside the
 * Document Number, naming the Revision on the page ("Original", "Revision 1"), always shown. It
 * opens "Revisions you can see": the chain's Revisions the viewer may see (V1 each), newest first,
 * each by its Document Number, left to right in both languages, or "No number yet: Revision n".
 */
export function RevisionMenu({ locale: _locale, labels, revisions, currentId, onOpen }: RevisionMenuProps) {
  const [open, setOpen] = useState(false);
  const current = revisions.find((r) => r.id === currentId);
  if (!current) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-[8px] bg-brand-tint px-2.5 text-[12.5px] font-bold text-brand-fg hover:brightness-[.97]",
            focusRing,
          )}
        >
          <Icon name="git-branch" size={15} />
          {labels.name(current.revisionNo, current.documentNumber !== null)}
          <Icon name="chevron-down" size={15} />
        </button>
      </PopoverTrigger>
      <PopoverContent aria-label={labels.title} className="w-[min(360px,calc(100vw-2rem))] rounded-[12px] p-1.5">
        <h5 className="mx-2 my-1.5 text-[11.5px] font-bold tracking-[0.04em] text-muted uppercase rtl:tracking-normal">{labels.title}</h5>
        <ul className="flex flex-col">
          {[...revisions].reverse().map((r) => {
            const here = r.id === currentId;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  aria-current={here || undefined}
                  onClick={() => {
                    setOpen(false);
                    if (!here) onOpen(r.id);
                  }}
                  className={cn("flex w-full items-center gap-2.5 rounded-[8px] p-2 text-start hover:bg-hover", here && "bg-brand-tint", focusRing)}
                >
                  <Icon name={here ? "circle-check" : "file-text"} size={16} className={here ? "text-brand" : "text-faint"} />
                  <span className="min-w-0">
                    <b className="block text-[13px]">{r.documentNumber ? <DocNo value={r.documentNumber} /> : <span className="text-muted">{labels.noNumber(r.revisionNo)}</span>}</b>
                    <small className="text-[11.5px] text-muted">{labels.name(r.revisionNo, r.documentNumber !== null)}</small>
                  </span>
                  {here && <span className="ms-auto text-[11px] font-bold text-brand-fg">{labels.open}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
