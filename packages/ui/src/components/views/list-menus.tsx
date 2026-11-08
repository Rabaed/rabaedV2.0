"use client";

import { Fragment, useId, useRef, useState, type ElementType, type PointerEvent } from "react";
import { cn } from "../../lib/cn.ts";
import { focusRing } from "../form/control-styles.ts";
import { Icon, type IconName } from "../icon/icon.tsx";
import { toolbarButton, toolbarFilled } from "../list/list-toolbar.tsx";
import { RowActionsMenu, type RowActionsItem } from "../list/row-menu.tsx";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "../overlay/popover.tsx";

// The List's toolbar menus (RP-409, the owner's design): Group (GROUP BY Status, Discipline,
// Type, With, Zone, Code) and the ⋯ More menu with Export (RP-1141, the kit's `moreMenu()`).

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
  /**
   * What the row alone already says the viewer may do (RP-1175): offered at once, while `load` is asked,
   * so a slow answer never hides it; the API's answer replaces it once it comes.
   */
  known?: Partial<RowPermissions>;
  onAction: (action: RowAction) => void;
  labels: RowMenuLabels;
};

const rowIcons: Record<RowAction, IconName> = { open: "eye", edit: "edit", duplicate: "copy", resubmit: "refresh", download: "download", delete: "trash" };

/**
 * A row's ⋯ menu (the shared RowActionsMenu): Open, Edit, Duplicate, Resubmit, Download, then
 * Delete apart. Each but Open only where the viewer may take it, as the API answers when the menu
 * opens; the API checks again when it is taken.
 */
export function RowMenu({ subject, load, known, onAction, labels }: RowMenuProps) {
  const [permitted, setPermitted] = useState<RowPermissions | null | "loading">(null);
  // While the API is asked, only what the row says; once it answered, its answer; when the row can't be read, Open alone.
  const allowed: Partial<RowPermissions> | null = permitted === "loading" ? (known ?? null) : permitted;
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

/** One link of the toolbar's "More actions" menu, with an optional line under its name. */
export type MoreAction = { key: string; label: string; description?: string; icon: IconName; href: string };

export type MoreActionsMenuProps = {
  actions: MoreAction[];
  /** The button's accessible name and the menu's, e.g. "More actions". */
  label: string;
  /** The link component, e.g. Next.js `Link`. Defaults to `<a>`. */
  linkAs?: ElementType;
};

/**
 * The Kanban toolbar's ⋯ "More actions" menu (RP-637; RP-1141, the owner's answer of 2026-11-08):
 * links only, such as Import register and Imports. The List's is `ListMoreMenu`.
 */
export function MoreActionsMenu({ actions, label, linkAs = "a" }: MoreActionsMenuProps) {
  return (
    <Popover>
      <MoreTrigger label={label} />
      <PopoverContent aria-label={label} align="end" className="w-[300px] rounded-md p-1.5 shadow-lg">
        <nav aria-label={label}>
          {actions.map((action) => (
            <MoreLink key={action.key} action={action} linkAs={linkAs} />
          ))}
        </nav>
      </PopoverContent>
    </Popover>
  );
}

/** A row of the ⋯ More menu (the kit's `.pop.more .mi`): 38px or more, a 17px muted icon, a name with an optional line under it. */
const moreItem = cn(
  "flex min-h-[38px] w-full items-center gap-2.5 rounded-xs px-2.5 py-2 text-start text-[13.5px] text-text hover:bg-hover pointer-coarse:min-h-11",
  "[&>svg]:shrink-0 [&>svg]:text-muted",
  focusRing,
);
const moreSeparator = <div className="mx-1 my-1.5 h-px bg-border-subtle" />;

function MoreTrigger({ label }: { label: string }) {
  return (
    <PopoverTrigger asChild>
      <button
        type="button"
        aria-label={label}
        title={label}
        className={cn(toolbarButton, toolbarFilled, "px-2 pointer-coarse:min-w-11 data-[state=open]:bg-brand-tint data-[state=open]:text-brand-fg")}
      >
        <Icon name="dots" />
      </button>
    </PopoverTrigger>
  );
}

function MoreLink({ action, linkAs: Link }: { action: MoreAction; linkAs: ElementType }) {
  return (
    <PopoverClose asChild>
      <Link href={action.href} className={moreItem}>
        <Icon name={action.icon} size={17} />
        <span className="flex flex-1 flex-col gap-px">
          {action.label}
          {action.description && <small className="text-[11.5px] font-medium text-muted">{action.description}</small>}
        </span>
      </Link>
    </PopoverClose>
  );
}

/** One of Export's choices, e.g. "CSV (.csv) — visible columns". */
export type ExportChoice = { key: string; label: string; onSelect: () => void };

export type ListMoreMenuProps = {
  /** The button's accessible name and the menu's, e.g. "More actions". */
  label: string;
  /** Export, opening its choices beside the menu; without it, the menu has no Export. */
  export?: {
    label: string;
    /** The line under it, e.g. "2 selected" while rows are selected. */
    hint?: string;
    /** The choices' heading, e.g. "Export 42 submittals". */
    heading: string;
    choices: ExportChoice[];
    /** While an export is being made. */
    busy?: boolean;
  };
  /** Links such as Import register and Imports (RP-637). */
  links?: MoreAction[];
  /** The link component, e.g. Next.js `Link`. Defaults to `<a>`. */
  linkAs?: ElementType;
  /** Column settings, apart at the end: `open` shows the table's column settings panel. */
  columnSettings?: { label: string; open: () => void };
  /** The row going back from Export's choices, where they take the menu's place (under 768 wide). */
  back: string;
};

/**
 * The List toolbar's ⋯ More menu (RP-1141, the kit's `moreMenu()`): Export, whose choices open
 * beside the menu (on hover, click or an arrow key; Escape goes back), the links, then Column settings.
 */
export function ListMoreMenu({ label, export: exporting, links = [], linkAs = "a", columnSettings, back }: ListMoreMenuProps) {
  const id = useId();
  const [sub, setSub] = useState(false);
  const exportRow = useRef<HTMLButtonElement>(null);
  const choices = useRef<HTMLDivElement>(null);
  // Column settings opens once this menu has closed and given back the focus, so the panel keeps it.
  const afterClose = useRef<(() => void) | null>(null);
  const openChoices = () => {
    setSub(true);
    requestAnimationFrame(() => choices.current?.querySelector<HTMLButtonElement>("button:not([data-back])")?.focus());
  };
  const closeChoices = () => {
    setSub(false);
    requestAnimationFrame(() => exportRow.current?.focus());
  };
  const hoverOthers = { onPointerEnter: (e: PointerEvent) => e.pointerType === "mouse" && setSub(false) };
  return (
    <Popover onOpenChange={(open) => !open && setSub(false)}>
      <MoreTrigger label={label} />
      <PopoverContent
        aria-label={label}
        align="end"
        className="relative w-[300px] rounded-md p-1.5 shadow-lg"
        onEscapeKeyDown={(e) => {
          if (!sub) return;
          e.preventDefault();
          closeChoices();
        }}
        onCloseAutoFocus={(e) => {
          const then = afterClose.current;
          if (!then) return;
          afterClose.current = null;
          e.preventDefault();
          then();
        }}
      >
        <div className={cn(sub && "max-md:hidden")}>
          {exporting && (
            <button
              ref={exportRow}
              type="button"
              disabled={exporting.busy}
              aria-expanded={sub}
              aria-controls={`${id}-export`}
              onPointerEnter={(e) => e.pointerType === "mouse" && setSub(true)}
              // A click opens them (a hover may have already); Enter or Space opens and closes them.
              onClick={(e) => (e.detail !== 0 ? setSub(true) : sub ? setSub(false) : openChoices())}
              onKeyDown={(e) => {
                if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                e.preventDefault();
                openChoices();
              }}
              className={cn(moreItem, sub && "bg-hover", "disabled:opacity-60")}
            >
              <Icon name="file-download" size={17} />
              <span className="flex flex-1 flex-col gap-px">
                {exporting.label}
                {exporting.hint && <small className="text-[11.5px] font-medium text-muted">{exporting.hint}</small>}
              </span>
              <Icon name="chevron-right" size={15} className="rtl:-scale-x-100" />
            </button>
          )}
          {links.map((action) => (
            <div key={action.key} {...hoverOthers}>
              <MoreLink action={action} linkAs={linkAs} />
            </div>
          ))}
          {columnSettings && (
            <div {...hoverOthers}>
              {(exporting || links.length > 0) && moreSeparator}
              <PopoverClose asChild>
                <button type="button" onClick={() => (afterClose.current = columnSettings.open)} className={moreItem}>
                  <Icon name="settings" size={17} />
                  <span className="flex-1">{columnSettings.label}</span>
                </button>
              </PopoverClose>
            </div>
          )}
        </div>
        {exporting && sub && (
          // Beside the menu on its start side (the kit's `.pop.subp`); under 768 wide, in its place.
          <div
            ref={choices}
            id={`${id}-export`}
            role="group"
            aria-labelledby={`${id}-export-title`}
            className="md:absolute md:end-[calc(100%+6px)] md:top-0 md:w-[290px] md:rounded-md md:border md:border-menu-border md:bg-surface md:p-1.5 md:shadow-lg"
          >
            <button type="button" data-back onClick={closeChoices} className={cn(moreItem, "md:hidden")}>
              <Icon name="chevron-left" size={17} className="rtl:-scale-x-100" />
              <span className="flex-1">{back}</span>
            </button>
            <h2 id={`${id}-export-title`} className="px-2.5 pt-2 pb-1 text-[10.5px] font-bold tracking-[0.06em] text-muted uppercase">
              {exporting.heading}
            </h2>
            {exporting.choices.map((choice, i) => (
              <Fragment key={choice.key}>
                {/* The kit splits Excel from CSV. */}
                {i === 2 && moreSeparator}
                <PopoverClose asChild>
                  <button type="button" onClick={choice.onSelect} className={cn(moreItem, "min-h-9")}>
                    {choice.label}
                  </button>
                </PopoverClose>
              </Fragment>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
