"use client";

import { useContext } from "react";
import { cn } from "../../lib/cn.ts";
import { Button } from "../button/button.tsx";
import { ActionBarContext, PrimaryAction } from "../shell/action-bar.tsx";

export type SaveBarProps = {
  /** What the bar says: "No changes", "Unsaved changes" or "Saved". */
  status: string;
  /** Unsaved changes: the status reads as a warning, and Cancel and Save turn on. */
  dirty: boolean;
  /** A save is under way: Cancel and Save wait. */
  busy?: boolean;
  cancelLabel: string;
  saveLabel: string;
  onCancel: () => void;
  onSave: () => void;
  className?: string;
};

/**
 * The bar a page is saved whole from: its status at the start, Cancel and Save at the end (a Member's
 * Visibility, RP-1276, gap-table row 64). On a phone it is the shell's bottom action bar, stuck to the
 * screen's bottom edge above Safari's toolbar (RP-1272); wider, a card stuck to the bottom of the page.
 */
export function SaveBar({ status, dirty, busy = false, cancelLabel, saveLabel, onCancel, onSave, className }: SaveBarProps) {
  // The plain row only when portalled into the phone's bar; elsewhere the sticky card (gap-table row 64).
  const inActionBar = useContext(ActionBarContext)?.bar != null;
  return (
    <PrimaryAction>
      <div
        data-testid="save-bar"
        className={cn(
          "flex items-center justify-between gap-3",
          !inActionBar && "sticky bottom-0 z-10 rounded-lg border border-border bg-surface px-4 py-3 shadow-md",
          className,
        )}
      >
        <p role="status" className={cn("min-w-0 text-sm", dirty ? "font-semibold text-warning-fg" : "text-muted")}>
          {status}
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" disabled={!dirty || busy} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button disabled={!dirty || busy} onClick={onSave}>
            {saveLabel}
          </Button>
        </div>
      </div>
    </PrimaryAction>
  );
}
