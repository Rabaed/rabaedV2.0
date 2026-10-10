"use client";

import { useRef, type KeyboardEvent } from "react";
import { cn } from "../../lib/cn.ts";
import { IconButton } from "../button/button.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Icon, type IconName } from "../icon/icon.tsx";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "../overlay/popover.tsx";

// The "⋯" at the end of a list row: the row's commands in a small menu (RP-413).
// Presentational; the page owns what each command does.

export type RowActionsItem = {
  key: string;
  label: string;
  /** Before the label, as the kit's menus. */
  icon?: IconName;
  /** Runs after the menu closes. A command that needs a confirmation opens its own dialog here. */
  onSelect: () => void;
  /** `danger` for a command that cannot be taken back lightly, e.g. Deactivate. */
  tone?: "danger";
};

export type RowActionsMenuProps = {
  /** Names the button and the menu, e.g. "Actions for Hafiz Hamdan". */
  label: string;
  items: RowActionsItem[];
  /** A change is being saved: the button and every command are disabled until it is done. */
  busy?: boolean;
  className?: string;
};

/**
 * A "⋯" button opening a menu of commands. Keyboard: Enter or Space opens it and
 * puts focus on the first command; Up, Down, Home and End move between them;
 * Escape closes it and returns focus to the button.
 */
export function RowActionsMenu({ label, items, busy = false, className }: RowActionsMenuProps) {
  const list = useRef<HTMLDivElement>(null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const buttons = Array.from(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "ArrowDown" ? (at + 1) % buttons.length
      : event.key === "ArrowUp" ? (at - 1 + buttons.length) % buttons.length
      : event.key === "Home" ? 0
      : event.key === "End" ? buttons.length - 1
      : undefined;
    if (next === undefined) return;
    event.preventDefault();
    buttons[next]?.focus();
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton label={label} size="sm" aria-haspopup="menu" disabled={busy} aria-busy={busy || undefined} className={className}>
          <Icon name="dots" size={18} />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent ref={list} role="menu" aria-label={label} align="end" onKeyDown={onKeyDown} className="w-auto min-w-60 rounded-md border-border-strong p-1.5 shadow-lg">
        {items.map((item) => (
          <PopoverClose asChild key={item.key}>
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={item.onSelect}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-sm px-2.5 py-[9px] text-start text-[13.5px] font-medium whitespace-nowrap hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-60 pointer-coarse:min-h-11",
                item.tone === "danger" ? "text-danger-fg" : "text-text-secondary",
                focusRing,
              )}
            >
              {item.icon !== undefined && <Icon name={item.icon} size={17} className={item.tone === "danger" ? "text-danger-fg" : "text-muted"} />}
              {item.label}
            </button>
          </PopoverClose>
        ))}
      </PopoverContent>
    </Popover>
  );
}
