"use client";

import { lockedListColumns, type ListColumnKey, type ListColumnLayout } from "@rabaed/domain";
import { useId, useState, type KeyboardEvent } from "react";
import { cn } from "../../lib/cn.ts";
import { Button } from "../button/button.tsx";
import { focusRing, touchBox } from "../form/control-styles.ts";
import { Switch } from "../form/switch.tsx";
import { Icon } from "../icon/icon.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../overlay/popover.tsx";

// The List's column settings (RP-409, the owner's design): the gear at the end of
// the header row opens the columns in their order, each with a switch; the
// Document Number and Subject are locked. Drag a row, or move it with the arrow
// keys on its handle, to reorder. Reset goes back to the design's columns; "Save as
// my default" keeps them for the Member.

export type ColumnSettingsLabels = {
  /** The gear's name, e.g. "Table settings". */
  settings: string;
  /** The popover's title, e.g. "Columns". */
  title: string;
  /** "13 / 15 shown": `shown` and `total` written for the locale. */
  shown: (shown: string, total: string) => string;
  /** A locked column's lock, e.g. "Always shown". */
  locked: string;
  /** A row's handle, e.g. "Move Discipline". */
  move: (column: string) => string;
  reset: string;
  saveDefault: string;
};

export type ColumnSettingsProps = {
  columns: ListColumnLayout;
  /** Each column's header, as the table shows it. */
  headerOf: (key: ListColumnKey) => string;
  labels: ColumnSettingsLabels;
  /** Digits for the count. */
  number: (n: number) => string;
  /** A new order or switch: the table shows it at once. */
  onChange: (columns: ListColumnLayout) => void;
  /** Back to the design's columns. */
  onReset: () => void;
  /** Keeps the columns as the Member's own. */
  onSave: () => void;
  /** Opened at first (a story's picture of it). */
  defaultOpen?: boolean;
};

/** Moves the column at `from` to `to`, never above the locked columns. */
export function moveColumn(columns: ListColumnLayout, from: number, to: number): ListColumnLayout {
  const first = columns.findIndex((c) => !lockedListColumns.includes(c.key));
  if (from < first || to < first || from === to || to >= columns.length) return columns;
  const next = [...columns];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

export function ColumnSettings({ columns, headerOf, labels, number, onChange, onReset, onSave, defaultOpen }: ColumnSettingsProps) {
  const id = useId();
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const shown = columns.filter((c) => c.shown).length;
  const onKey = (event: KeyboardEvent, index: number) => {
    const to = event.key === "ArrowUp" ? index - 1 : event.key === "ArrowDown" ? index + 1 : null;
    if (to === null) return;
    event.preventDefault();
    const next = moveColumn(columns, index, to);
    if (next === columns) return;
    onChange(next);
    // The handle keeps the focus as its row moves.
    requestAnimationFrame(() => document.getElementById(`${id}-move-${next[to]!.key}`)?.focus());
  };
  return (
    <Popover defaultOpen={defaultOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={labels.settings}
          title={labels.settings}
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-xs text-text-secondary hover:bg-hover hover:text-text data-[state=open]:bg-brand-tint data-[state=open]:text-brand-fg",
            focusRing,
            touchBox,
          )}
        >
          <Icon name="settings" size={17} />
        </button>
      </PopoverTrigger>
      <PopoverContent aria-labelledby={`${id}-title`} align="end" className="flex w-[280px] flex-col overflow-hidden rounded-md p-0 shadow-lg">
        <div className="flex items-center gap-2 border-b border-border-subtle px-[14px] py-3">
          <Icon name="settings" size={16} className="text-text-secondary" />
          <h2 id={`${id}-title`} className="text-[13.5px] font-bold text-text">
            {labels.title}
          </h2>
          <span className="ms-auto text-caption text-muted">{labels.shown(number(shown), number(columns.length))}</span>
        </div>
        <ul className="max-h-[calc(100dvh-14rem)] overflow-auto px-1.5 py-1">
          {columns.map((column, index) => {
            const locked = lockedListColumns.includes(column.key);
            const header = headerOf(column.key);
            return (
              <li
                key={column.key}
                draggable={!locked}
                onDragStart={(event) => {
                  setDragging(index);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", column.key);
                }}
                onDragOver={(event) => {
                  if (dragging === null || locked) return;
                  event.preventDefault();
                  setOver(index);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragging !== null) onChange(moveColumn(columns, dragging, index));
                  setDragging(null);
                  setOver(null);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                }}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-xs px-2 text-[13.5px] text-text hover:bg-hover",
                  locked && "text-muted",
                  dragging === index && "opacity-40",
                  over === index && dragging !== index && "shadow-[inset_0_2px_0_var(--color-primary)]",
                )}
              >
                {locked ? (
                  <Icon name="grid-dots" size={14} className="shrink-0 text-faint" />
                ) : (
                  <button
                    type="button"
                    id={`${id}-move-${column.key}`}
                    aria-label={labels.move(header)}
                    title={labels.move(header)}
                    onKeyDown={(event) => onKey(event, index)}
                    className={cn("inline-flex shrink-0 cursor-grab rounded-xs text-faint hover:text-text", focusRing)}
                  >
                    <Icon name="grid-dots" size={14} />
                  </button>
                )}
                <label htmlFor={`${id}-${column.key}`} className={cn("min-w-0 flex-1 truncate", !locked && "cursor-pointer")}>
                  {header}
                </label>
                {locked ? (
                  <span id={`${id}-${column.key}`} title={labels.locked} className="inline-flex text-faint">
                    <Icon name="lock" size={14} />
                    <span className="sr-only">{labels.locked}</span>
                  </span>
                ) : (
                  <Switch
                    id={`${id}-${column.key}`}
                    checked={column.shown}
                    onCheckedChange={(on) => onChange(columns.map((c) => (c.key === column.key ? { ...c, shown: on } : c)))}
                  />
                )}
              </li>
            );
          })}
        </ul>
        <div className="flex gap-2 border-t border-border-subtle bg-surface-subtle px-3 py-2.5">
          <Button variant="secondary" size="sm" className="flex-1" onClick={onReset}>
            {labels.reset}
          </Button>
          <Button size="sm" className="flex-1" onClick={onSave}>
            <Icon name="check" />
            {labels.saveDefault}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
