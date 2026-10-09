"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { focusRing } from "../form/control-styles.ts";
import { Switch } from "../form/switch.tsx";
import { Icon } from "../icon/icon.tsx";

// The toolbar of a data list page (kit `list/list.js` toolbar, RP-409): the
// page's primary action, search, the Filters button and switches at the start,
// the view switch at the end. Presentational; the page owns the query.

export type ListToolbarProps = {
  /** Names the toolbar's region, e.g. "Filters and sort". */
  label: string;
  /** Start to end: the primary action, `ToolbarSearch`, `FilterMenu`, `ToolbarSwitch`es. */
  children: ReactNode;
  /** Pushed to the inline end, e.g. the List / Kanban switch. */
  end?: ReactNode;
  className?: string;
};

/** One wrapping row of the list's controls. */
export function ListToolbar({ label, children, end, className }: ListToolbarProps) {
  return (
    <section aria-label={label} className={cn("flex flex-wrap items-center gap-2", className)}>
      {children}
      {end !== undefined && <div className="ms-auto flex flex-wrap items-center gap-2">{end}</div>}
    </section>
  );
}

export type ToolbarSearchProps = {
  /** The box's accessible name, e.g. "Search". */
  label: string;
  placeholder?: string;
  /** What the search looks in, read with the box (not shown). */
  description?: string;
  /** The words of the search the page shows. Give the component a `key` of it, so a new query shows its own words. */
  value: string | undefined;
  maxLength?: number;
  /** 42px tall, as the Kanban Board Anatomy's toolbar (RP-410); 36px otherwise. */
  tall?: boolean;
  /** Asked for on Enter, with the trimmed words; undefined for an emptied box. */
  onSearch: (words: string | undefined) => void;
  className?: string;
};

/**
 * The list's search box: compact, with a "/" hint. Pressing "/" anywhere on the
 * page (outside a text box) puts the cursor in it; Enter searches.
 */
export function ToolbarSearch({ label, placeholder, description, value, maxLength, tall = false, onSearch, className }: ToolbarSearchProps) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='combobox']")) return;
      event.preventDefault();
      input.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <form
      role="search"
      className={cn("w-full sm:w-56", className)}
      onSubmit={(event) => {
        event.preventDefault();
        const words = String(new FormData(event.currentTarget).get("q") ?? "").trim();
        onSearch(words === "" ? undefined : words);
      }}
    >
      <label
        htmlFor={id}
        className={cn(
          "flex items-center gap-2 rounded-sm border border-control-border bg-surface px-2.5 text-muted hover:border-control-border-hover",
          tall ? "h-[42px]" : "h-9",
          "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus pointer-coarse:min-h-11",
        )}
      >
        <Icon name="search" size={16} />
        <span className="sr-only">{label}</span>
        <input
          ref={input}
          id={id}
          type="search"
          name="q"
          defaultValue={value ?? ""}
          placeholder={placeholder}
          maxLength={maxLength}
          aria-describedby={description === undefined ? undefined : `${id}-help`}
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted"
        />
        <kbd aria-hidden="true" className="hidden rounded-xs border border-border px-1.5 font-ui text-micro font-semibold text-muted sm:inline">
          /
        </kbd>
      </label>
      {description !== undefined && (
        <span id={`${id}-help`} hidden>
          {description}
        </span>
      )}
    </form>
  );
}

export type ToolbarSwitchProps = {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

/** An on/off choice in the toolbar that applies at once, e.g. Need My Action: a switch and its label. */
export function ToolbarSwitch({ label, checked, onCheckedChange }: ToolbarSwitchProps) {
  const id = useId();
  return (
    <div className="inline-flex h-[42px] shrink-0 items-center gap-2 rounded-sm border border-border-strong bg-surface px-3 text-sm font-semibold whitespace-nowrap text-text-secondary hover:bg-hover pointer-coarse:min-h-11">
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
      <label htmlFor={id} className="cursor-pointer select-none">
        {label}
      </label>
    </div>
  );
}

/** The shared look of a compact toolbar button (Filter, Card view layout), for a `button` or a trigger: white, outlined. */
export const toolbarButton = cn(
  "inline-flex h-[42px] shrink-0 items-center gap-1.5 rounded-sm border border-border-strong bg-surface px-3 text-sm font-semibold whitespace-nowrap text-text-secondary",
  "hover:bg-hover active:bg-press data-[state=open]:bg-press pointer-coarse:min-h-11",
  "[&_svg]:size-4 [&_svg]:shrink-0",
  focusRing,
);
