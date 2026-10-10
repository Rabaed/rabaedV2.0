"use client";

import { useId, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { focusRing } from "../form/control-styles.ts";
import { Icon, type IconName } from "../icon/icon.tsx";
import { toolbarButton, toolbarFilled } from "../list/list-toolbar.tsx";
import { RowActionsMenu, type RowActionsItem } from "../list/row-menu.tsx";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "../overlay/popover.tsx";

// The List's toolbar menus (RP-409, the owner's design): Group (GROUP BY Status, Discipline,
// Type, Current owner, Zone, Code) and Export with its arrow (CSV, Excel). List only.

/** One choice of a toolbar menu. */
export const menuItem = cn(
  "flex w-full items-center gap-2 rounded-xs px-2.5 py-2 text-start text-[13.5px] whitespace-nowrap text-text hover:bg-hover pointer-coarse:min-h-11",
  "[&_svg]:shrink-0 [&_svg]:text-muted",
  focusRing,
);

export type GroupMenuProps<K extends string> = {
  /** The groupings, in the menu's order, each with its name (a column's header). */
  choices: { key: K; label: string }[];
  /** The grouping now; null for none. */
  value: K | null;
  onChange: (value: K | null) => void;
  labels: { group: string; groupBy: string; groupedBy: (by: string) => string; clear: string };
};

export function GroupMenu<K extends string>({ choices, value, onChange, labels }: GroupMenuProps<K>) {
  const id = useId();
  const current = choices.find((c) => c.key === value);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={current ? labels.groupedBy(current.label) : undefined}
          title={current ? labels.groupedBy(current.label) : undefined}
          className={cn(toolbarButton, toolbarFilled, current && "bg-brand-tint text-brand-fg hover:bg-brand-tint")}
        >
          <Icon name="category" />
          {current ? (
            <>
              {/* Below 1440 wide only the value, so the toolbar keeps one row; the name says it whole. */}
              <span className="hidden min-[1440px]:inline">{labels.groupedBy(current.label)}</span>
              <span className="min-[1440px]:hidden">{current.label}</span>
            </>
          ) : (
            labels.group
          )}
          <Icon name="chevron-down" />
        </button>
      </PopoverTrigger>
      <PopoverContent aria-labelledby={`${id}-title`} align="end" className="w-52 rounded-md p-1 shadow-lg">
        <h2 id={`${id}-title`} className="px-2.5 pt-2 pb-1 text-[10.5px] font-bold tracking-[0.06em] text-muted uppercase">
          {labels.groupBy}
        </h2>
        <ul>
          {choices.map((c) => (
            <li key={c.key}>
              <PopoverClose asChild>
                <button
                  type="button"
                  aria-pressed={c.key === value}
                  onClick={() => onChange(c.key)}
                  className={cn(menuItem, c.key === value && "bg-brand-tint font-semibold text-brand-fg")}
                >
                  {c.label}
                  {c.key === value && <Icon name="check" size={16} className="ms-auto text-brand-fg" />}
                </button>
              </PopoverClose>
            </li>
          ))}
        </ul>
        {current && (
          <>
            <div className="m-1 h-px bg-border-subtle" />
            <PopoverClose asChild>
              <button type="button" onClick={() => onChange(null)} className={menuItem}>
                {labels.clear}
              </button>
            </PopoverClose>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** What a row's ⋯ menu offers (RP-409, the owner's design). */
export const rowActions = ["open", "edit", "duplicate", "resubmit", "download", "delete"] as const;
export type RowAction = (typeof rowActions)[number];
/** Which of a row's actions the viewer may take now, as the API says; Open always. */
export type RowPermissions = Record<Exclude<RowAction, "open">, boolean>;

export type RowMenuLabels = Record<RowAction, string> & {
  /** The ⋯ button, e.g. "More for Fire Suppression System". */
  more: (subject: string) => string;
  /** While the menu asks what the viewer may do. */
  loading: string;
};

export type RowMenuProps = {
  subject: string;
  /** Asked when the menu opens: what the viewer may do with the row now (null when it can't be read). */
  load: () => Promise<RowPermissions | null>;
  onAction: (action: RowAction) => void;
  labels: RowMenuLabels;
};

const rowIcons: Record<RowAction, IconName> = { open: "eye", edit: "edit", duplicate: "copy", resubmit: "refresh", download: "download", delete: "trash" };

/**
 * A row's ⋯ menu (the shared RowActionsMenu): Open, Edit, Duplicate, Resubmit, Download, then
 * Delete apart. Each but Open only where the viewer may take it, as the API answers when the menu
 * opens; the API checks again when it is taken.
 */
export function RowMenu({ subject, load, onAction, labels }: RowMenuProps) {
  const [permitted, setPermitted] = useState<RowPermissions | null | "loading">(null);
  const allowed = permitted !== null && permitted !== "loading" ? permitted : null;
  const item = (action: RowAction): RowActionsItem => ({
    key: action,
    label: labels[action],
    icon: rowIcons[action],
    onSelect: () => onAction(action),
    ...(action === "delete" ? { tone: "danger" as const, separated: true } : {}),
  });
  const shown: RowAction[] = ["open", ...(["edit", "duplicate", "resubmit", "download", "delete"] as const).filter((a) => allowed?.[a])];
  return (
    <RowActionsMenu
      label={labels.more(subject)}
      // The design's 28px button, so the table's last column stays narrow.
      className="h-7 w-7 text-text-secondary"
      width="narrow"
      items={shown.map(item)}
      status={permitted === "loading" ? labels.loading : undefined}
      onOpenChange={(open) => {
        if (!open) return;
        setPermitted("loading");
        void load().then(setPermitted, () => setPermitted(null));
      }}
    />
  );
}

export type ExportFormat = "csv" | "excel";
/** "What you see" (the shown columns) or "the whole table" (every List field), RP-409 owner decision. */
export type ExportScope = "shown" | "whole";

export type ExportMenuProps = {
  onExport: (format: ExportFormat, scope: ExportScope) => void;
  labels: { export: string; options: string; shown: string; whole: string; csv: string; excel: string };
  /** While an export is being made. */
  busy?: boolean;
};

/** Export (what you see, CSV) with its arrow menu: what you see or the whole table, each as CSV or Excel. */
export function ExportMenu({ onExport, labels, busy = false }: ExportMenuProps) {
  const id = useId();
  const item = (format: ExportFormat, scope: ExportScope, icon: IconName, name: string, hint: ReactNode) => (
    <PopoverClose asChild key={`${scope}:${format}`}>
      <button type="button" onClick={() => onExport(format, scope)} className={menuItem}>
        <Icon name={icon} size={16} />
        {name}
        <small className="ms-auto text-[11.5px] text-muted">{hint}</small>
      </button>
    </PopoverClose>
  );
  const group = (scope: ExportScope, title: string) => (
    <div role="group" aria-labelledby={`${id}-${scope}`}>
      <h2 id={`${id}-${scope}`} className="px-2.5 pt-2 pb-1 text-[10.5px] font-bold tracking-[0.06em] text-muted uppercase">
        {title}
      </h2>
      {item("csv", scope, "file-text", labels.csv, ".csv")}
      {item("excel", scope, "table", labels.excel, ".xml")}
    </div>
  );
  return (
    <span className="inline-flex shrink-0">
      <button type="button" disabled={busy} onClick={() => onExport("csv", "shown")} className={cn(toolbarButton, toolbarFilled, "rounded-e-none disabled:opacity-60")}>
        <Icon name="file-download" />
        {labels.export}
      </button>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={labels.options}
            title={labels.options}
            disabled={busy}
            className={cn(toolbarButton, toolbarFilled, "-ms-px rounded-s-none px-2 pointer-coarse:min-w-11")}
          >
            <Icon name="chevron-down" />
          </button>
        </PopoverTrigger>
        <PopoverContent aria-label={labels.options} align="end" className="w-60 rounded-md p-1 shadow-lg">
          {group("shown", labels.shown)}
          <div className="m-1 h-px bg-border-subtle" />
          {group("whole", labels.whole)}
        </PopoverContent>
      </Popover>
    </span>
  );
}
