"use client";

import { useId, useState, type ElementType } from "react";
import { cn } from "../../lib/cn.ts";
import { IconButton } from "../button/button.tsx";
import { focusRing } from "../form/control-styles.ts";
import { DocNo } from "../doc-no/doc-no.tsx";
import { Icon, type IconName } from "../icon/icon.tsx";

// One linked item in a list (form-engine.md part 2b; visibility.md E1, E3): the
// other item's Document Number (left to right) and Subject. One the viewer can
// see opens it; one they can't comes without an id, so opening it only says they
// may not see its details: on the page of the Link to it, by the Link's own id,
// when there is one (RP-521), else right here. Shared by the Links section,
// Linked from and the link question.

/** The row's words, from the app's messages. */
export type LinkedItemRowLabels = {
  /** Said of an item the viewer can't see. */
  hidden: string;
  /** "No access": shown beside the lock on such an item (the Work Item page, RP-1151 row 54); only the lock without it. */
  noAccess?: string;
};

export type LinkedItemRowProps = {
  labels: LinkedItemRowLabels;
  documentNumber: string;
  subject: string;
  /**
   * Where the row opens: the item, or for one the viewer can't see the page of
   * the Link to it (RP-521), which says only that they may not see its details.
   * Null: opening it shows that sentence here.
   */
  href: string | null;
  /** The viewer can't see the item (a lock marks it); by default, when there is nowhere to open. */
  hidden?: boolean;
  /** The link component, e.g. the app's `Link`. */
  linkAs: ElementType;
  /** A button removing the item, when it may be removed. */
  remove?: { label: string; icon: IconName; disabled?: boolean; onRemove: () => void };
  /**
   * "rows": the Work Item page's rows (RP-1188, gap table rows 52–53): a bordered row each, a link icon, the
   * number on one line, the Subject in the brand colour and an arrow; "list" (default): the plain list.
   */
  look?: "list" | "rows";
};

/** A list item: the linked item, opening it or saying the viewer may not see it, and its remove button. */
export function LinkedItemRow({ labels: text, documentNumber, subject, href, hidden = href === null, linkAs: Anchor, remove, look = "list" }: LinkedItemRowProps) {
  const messageId = useId();
  const [explained, setExplained] = useState(false);
  const rows = look === "rows";
  const target = cn(
    rows
      ? "flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-[10px] px-3 py-2 text-start text-[13px] hover:bg-ghost-hover active:bg-ghost-press"
      : "flex min-h-11 min-w-0 flex-1 flex-col items-start gap-0.5 rounded-sm px-3 py-2 text-start hover:bg-ghost-hover active:bg-ghost-press",
    focusRing,
  );
  const label = rows ? (
    <>
      <Icon name="link" size={14} className="shrink-0 text-muted" />
      {/* The number on one line, whatever the row's width (row 53). */}
      <DocNo value={documentNumber} className="shrink-0 font-bold whitespace-nowrap text-text" />
      <span className="min-w-0 flex-1 text-brand-fg">
        <bdi>{subject}</bdi>
      </span>
      {!hidden && <Icon name="arrow-up-right" size={14} className="shrink-0 text-muted rtl:-scale-x-100" />}
    </>
  ) : (
    <>
      <DocNo value={documentNumber} className="text-sm text-text" />
      <span className="text-body text-text">
        <bdi>{subject}</bdi>
      </span>
    </>
  );
  return (
    <li className={cn("flex flex-col", rows && "rounded-[10px] border border-border-subtle bg-surface")}>
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
        {hidden &&
          (text.noAccess ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-[11.5px] font-semibold whitespace-nowrap text-muted">
              <Icon name="lock" size={14} label={text.hidden} />
              {text.noAccess}
            </span>
          ) : (
            <Icon name="lock" size={16} label={text.hidden} className="shrink-0 text-muted" />
          ))}
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
