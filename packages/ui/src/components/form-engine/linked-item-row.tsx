"use client";

import type { Locale } from "@rabaed/domain";
import { useId, useState, type ElementType } from "react";
import { cn } from "../../lib/cn.ts";
import { IconButton } from "../button/button.tsx";
import { focusRing } from "../form/control-styles.ts";
import { DocNo } from "../doc-no/doc-no.tsx";
import { Icon, type IconName } from "../icon/icon.tsx";

// One linked item in a list (form-engine.md part 2b; visibility.md E1, E3): the
// other item's Document Number (left to right) and Subject. One the viewer can
// see opens it; one they can't comes without an id, so opening it only says they
// may not see its details, and asks nothing of the API. Shared by the Links
// section, Linked from and the link question.

/* eslint-disable rabaed/no-ui-translations -- existing labels, still to move to the app's messages (RP-362 retro) */
const copy = {
  en: { hidden: "You are not allowed to see the details of this item." },
  ar: { hidden: "غير مسموح لك برؤية تفاصيل هذا البند." },
} satisfies Record<Locale, unknown>;
/* eslint-enable rabaed/no-ui-translations */

export type LinkedItemRowProps = {
  locale: Locale;
  documentNumber: string;
  subject: string;
  /** Where the item opens; null for one the viewer can't see. */
  href: string | null;
  /** The link component, e.g. the app's `Link`. */
  linkAs: ElementType;
  /** A button removing the item, when it may be removed. */
  remove?: { label: string; icon: IconName; disabled?: boolean; onRemove: () => void };
};

/** A list item: the linked item, opening it or saying the viewer may not see it, and its remove button. */
export function LinkedItemRow({ locale, documentNumber, subject, href, linkAs: Anchor, remove }: LinkedItemRowProps) {
  const text = copy[locale];
  const messageId = useId();
  const [explained, setExplained] = useState(false);
  const target = cn(
    "flex min-h-11 min-w-0 flex-1 flex-col items-start gap-0.5 rounded-sm px-3 py-2 text-start hover:bg-ghost-hover active:bg-ghost-press",
    focusRing,
  );
  const label = (
    <>
      <DocNo value={documentNumber} className="text-sm text-text" />
      <span className="text-body text-text">
        <bdi>{subject}</bdi>
      </span>
    </>
  );
  return (
    <li className="flex flex-col">
      <div className="flex items-center gap-1 pe-1">
        {href !== null ? (
          <Anchor href={href} className={target}>
            {label}
          </Anchor>
        ) : (
          // No id for an item the viewer can't see: opening it only explains why.
          <button type="button" className={target} aria-expanded={explained} aria-controls={messageId} onClick={() => setExplained((open) => !open)}>
            {label}
          </button>
        )}
        {href === null && <Icon name="lock" size={16} label={text.hidden} className="shrink-0 text-muted" />}
        {remove && (
          <IconButton label={remove.label} size="sm" disabled={remove.disabled} onClick={remove.onRemove}>
            <Icon name={remove.icon} size={16} />
          </IconButton>
        )}
      </div>
      {href === null && (
        <p id={messageId} className={cn("px-3 pb-2 text-sm text-muted", !explained && "hidden")}>
          {text.hidden}
        </p>
      )}
    </li>
  );
}
