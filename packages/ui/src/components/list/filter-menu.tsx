"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import { Fragment, useId, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { useMediaQuery } from "../../lib/use-media-query.ts";
import { Button } from "../button/button.tsx";
import { focusRing, touchBox } from "../form/control-styles.ts";
import { Icon } from "../icon/icon.tsx";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "../overlay/popover.tsx";
import { Sheet, SheetClose, SheetContent, SheetFooter, SheetTrigger } from "../overlay/sheet.tsx";
import { toolbarButton } from "./list-toolbar.tsx";

// The Filter button of a data list page and what it opens (the owner's Kanban
// Board Anatomy, "Filter panel", RP-410; kit `list/filter-panel.js`): from `md` a
// panel with the fields on the start side, in groups, each with how many of its
// values are picked, and "Clear all" under them; the chosen field's values
// beside them (`FilterValues`: checkboxes, or one choice for dates); the footer
// says how many filters are applied, with Done. Below `md` a sheet with every
// field one under the other. Each choice applies at once (the page keeps it in
// its URL); Done only closes. The button shows how many fields are filtered and
// turns tomato while the panel is open.

export type FilterMenuField = {
  key: string;
  label: string;
  /** The field's name in the other language, shown small after it (the anatomy's bilingual field list). */
  hint?: string;
  /** How many of its values are chosen: shown beside its name, and a field with any counts as one filter applied. */
  count: number;
  /** Fields of one group sit together, a line between groups, e.g. workflow · plan location · time. */
  group?: string;
  /** Its values, e.g. `FilterValues`, or a date range. */
  content: ReactNode;
};

export type FilterMenuLabels = {
  /** The button's and the panel's name, e.g. "Filter". */
  filters: string;
  clearAll: string;
  done: string;
  /** The sheet's close button. */
  close: string;
  /** The footer line: `n` is `count` written for the locale; `count` chooses the plural. */
  applied: (n: string, count: number) => string;
  /** A number written for the locale (`formatNumber`), for the counts. */
  number: (n: number) => string;
};

export type FilterMenuProps = {
  fields: FilterMenuField[];
  labels: FilterMenuLabels;
  /** Clears every filter of the menu. Without it, no "Clear all". */
  onClearAll?: () => void;
  /** The field shown first in the panel; defaults to the first. */
  initialField?: string;
  /** Extra classes for the button, e.g. to join it to a control beside it. */
  triggerClassName?: string;
};

/** The Filter button with the number of fields filtered, opening the filter panel. */
export function FilterMenu({ fields, labels, onClearAll, initialField, triggerClassName }: FilterMenuProps) {
  const wide = useMediaQuery("(min-width: 48rem)");
  const applied = fields.filter((f) => f.count > 0).length;
  const trigger = (
    <button
      type="button"
      className={cn(toolbarButton, "data-[state=open]:border-brand data-[state=open]:bg-brand-tint data-[state=open]:text-brand-fg", triggerClassName)}
    >
      <Icon name="filter" />
      {labels.filters}
      {/* The space keeps the name "Filter 2" for screen readers. */}
      {applied > 0 && " "}
      {applied > 0 && (
        <span className="min-w-5 rounded-full bg-primary px-1.5 text-center font-ui text-notes leading-5 font-bold text-on-primary">
          {labels.number(applied)}
        </span>
      )}
    </button>
  );
  const footerLine = <span className="text-sm text-muted">{labels.applied(labels.number(applied), applied)}</span>;

  if (!wide) {
    return (
      <Sheet>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent title={labels.filters} closeLabel={labels.close}>
          <div className="flex flex-col gap-6">
            {fields.map((field) => (
              <StackedField key={field.key} field={field} number={labels.number} />
            ))}
          </div>
          <SheetFooter className="sticky bottom-0 items-center justify-between border-t border-border bg-surface pt-4">
            {footerLine}
            <div className="flex gap-2">
              {onClearAll && (
                <Button variant="ghost" disabled={applied === 0} onClick={onClearAll}>
                  {labels.clearAll}
                </Button>
              )}
              <SheetClose asChild>
                <Button>{labels.done}</Button>
              </SheetClose>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent aria-label={labels.filters} className="w-[37.5rem] overflow-hidden rounded-[14px] border-border-strong p-0 shadow-lg">
        <FieldTabs
          fields={fields}
          number={labels.number}
          initialField={initialField}
          label={labels.filters}
          clearAll={
            onClearAll && (
              <button
                type="button"
                disabled={applied === 0}
                onClick={onClearAll}
                className={cn(
                  "mt-auto rounded-sm px-2.5 py-2 text-start text-sm font-semibold text-muted hover:text-brand-fg disabled:cursor-default disabled:opacity-40 disabled:hover:text-muted",
                  focusRing,
                )}
              >
                {labels.clearAll}
              </button>
            )
          }
        />
        <div className="flex items-center justify-between gap-3 border-t border-border bg-surface-subtle px-4 py-2.5">
          {footerLine}
          <PopoverClose asChild>
            <Button size="sm">{labels.done}</Button>
          </PopoverClose>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CountPill({ count, number }: { count: number; number: (n: number) => string }) {
  if (count === 0) return null;
  // The space keeps the name "Stage 1" for screen readers.
  return (
    <>
      {" "}
      <span className="ms-auto min-w-[18px] rounded-full bg-primary px-1.5 text-center font-ui text-micro leading-[17px] font-bold text-on-primary">
        {number(count)}
      </span>
    </>
  );
}

/** A field's name on one line, and its name in the other language after it; either cut with an ellipsis, both in the tooltip. */
function FieldName({ field }: { field: FilterMenuField }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5" title={field.hint ? `${field.label} · ${field.hint}` : field.label}>
      <span className="min-w-0 shrink truncate">{field.label}</span>
      {field.hint && (
        <span aria-hidden="true" className="min-w-0 shrink-[2] truncate text-notes font-normal text-muted">
          {field.hint}
        </span>
      )}
    </span>
  );
}

/** The panel's body: the fields as vertical tabs in their groups, the chosen one's values beside them. */
function FieldTabs({
  fields,
  number,
  initialField,
  label,
  clearAll,
}: {
  fields: FilterMenuField[];
  number: (n: number) => string;
  initialField?: string;
  label: string;
  clearAll?: ReactNode;
}) {
  const [current, setCurrent] = useState(initialField ?? fields[0]?.key ?? "");
  return (
    <TabsPrimitive.Root value={current} onValueChange={setCurrent} orientation="vertical" className="grid min-h-[22rem] grid-cols-[13.75rem_minmax(0,1fr)]">
      <div className="flex flex-col border-e border-border p-2">
        <TabsPrimitive.List aria-label={label} className="flex flex-col gap-px">
          {fields.map((field, i) => (
            <Fragment key={field.key}>
              {i > 0 && field.group !== fields[i - 1]!.group && <span aria-hidden="true" className="mx-1 my-1.5 h-px bg-border" />}
              <TabsPrimitive.Trigger
                value={field.key}
                className={cn(
                  "flex min-h-[34px] items-center gap-2 rounded-sm px-2.5 text-start text-sm text-text-secondary hover:bg-hover",
                  "data-[state=active]:bg-brand-tint data-[state=active]:font-semibold data-[state=active]:text-brand-fg",
                  focusRing,
                )}
              >
                <FieldName field={field} />
                <CountPill count={field.count} number={number} />
              </TabsPrimitive.Trigger>
            </Fragment>
          ))}
        </TabsPrimitive.List>
        {clearAll}
      </div>
      {fields.map((field) => (
        <TabsPrimitive.Content key={field.key} value={field.key} className={cn("flex max-h-[26rem] min-w-0 flex-col overflow-y-auto py-2.5", focusRing)}>
          {field.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}

/** A field in the sheet: its name as a heading, its values under it. */
function StackedField({ field, number }: { field: FilterMenuField; number: (n: number) => string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 id={id} className="flex items-center gap-2 text-body font-semibold">
        <FieldName field={field} />
        <CountPill count={field.count} number={number} />
      </h3>
      {field.content}
    </section>
  );
}

export type FilterChoice = {
  value: string;
  label: ReactNode;
  /** The text the value search matches; the label when it is a string. */
  text?: string;
  /** A mark before the label, e.g. a Stage's dot, a Trade's chip, an avatar or Step Age dots. Decorative. */
  mark?: ReactNode;
};

export type FilterValuesLabels = {
  /** Clears this field, e.g. "Clear". */
  clear: string;
  /** The value search's name and placeholder, e.g. "Search". */
  search: string;
  /** When the value search finds nothing. */
  noMatches: string;
};

export type FilterValuesProps = {
  /** The field's name, e.g. "Status", heading its values. */
  label: string;
  /** Its name in the other language, small after it. */
  hint?: string;
  /** The values chosen. */
  values: readonly string[];
  /** Checkboxes (any of them), or one choice (radio), as dates are. */
  multiple?: boolean;
  choices: FilterChoice[];
  onChange: (values: string[]) => void;
  labels: FilterValuesLabels;
};

/** Above this many values, a search box narrows them. */
const searchAbove = 5;

/**
 * A field's values in the filter panel: its name with "Clear", a search box when
 * it has more than five, and its values as checkboxes (or one choice), each
 * with its mark: a Stage's dot, a Trade's chip, an owner's avatar.
 */
export function FilterValues({ label, hint, values, multiple = true, choices, onChange, labels }: FilterValuesProps) {
  const [search, setSearch] = useState("");
  const id = useId();
  const words = search.trim().toLocaleLowerCase();
  const shown = words
    ? choices.filter((c) => (c.text ?? (typeof c.label === "string" ? c.label : "")).toLocaleLowerCase().includes(words))
    : choices;
  const toggle = (value: string) => {
    const on = values.includes(value);
    if (multiple) onChange(on ? values.filter((v) => v !== value) : [...values, value]);
    else onChange(on ? [] : [value]);
  };
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-baseline gap-1.5 px-[14px] pt-0.5 pb-2">
        <span id={id} className="text-sm font-bold text-text">
          {label}
        </span>
        {hint && (
          <span aria-hidden="true" className="text-notes text-muted">
            {hint}
          </span>
        )}
        {values.length > 0 && (
          <button type="button" onClick={() => onChange([])} className={cn("ms-auto rounded-xs text-caption font-semibold text-brand-fg hover:underline pointer-coarse:justify-center", touchBox, focusRing)}>
            {labels.clear}
          </button>
        )}
      </div>
      {choices.length > searchAbove && (
        <label className="mx-3 mb-1.5 flex h-8 items-center gap-2 rounded-sm border border-border-strong px-2.5 text-muted focus-within:border-brand">
          <Icon name="search" size={15} />
          <span className="sr-only">{labels.search}</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={labels.search}
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted"
          />
        </label>
      )}
      <div role={multiple ? "group" : "radiogroup"} aria-labelledby={id} className="flex flex-col gap-px px-1.5">
        {shown.map((choice) => {
          const on = values.includes(choice.value);
          return (
            <button
              key={choice.value}
              type="button"
              role={multiple ? "checkbox" : "radio"}
              aria-checked={on}
              onClick={() => toggle(choice.value)}
              className={cn(
                "flex min-h-[34px] w-full items-center gap-2.5 rounded-sm px-2 text-start text-sm text-text-secondary hover:bg-hover pointer-coarse:min-h-11",
                focusRing,
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center border-[1.5px] border-control-border",
                  multiple ? "rounded-xs" : "rounded-full",
                  on && "border-primary bg-primary text-on-primary",
                )}
              >
                {on && <Icon name="check" size={12} />}
              </span>
              {choice.mark !== undefined && (
                <span aria-hidden="true" className="inline-flex shrink-0">
                  {choice.mark}
                </span>
              )}
              <span className="min-w-0">{choice.label}</span>
            </button>
          );
        })}
        {shown.length === 0 && <p className="px-2 py-3 text-caption text-muted">{labels.noMatches}</p>}
      </div>
    </div>
  );
}

export type FilterChoicesProps = {
  /** Names the group of choices, e.g. "Stage". */
  label: string;
  /** The "no filter" choice, e.g. "All". */
  allLabel: string;
  /** The chosen value; undefined for none. */
  value: string | undefined;
  choices: FilterChoice[];
  /** Undefined when "All" is chosen. */
  onChange: (value: string | undefined) => void;
};

/** One choice from a list, or "All": a list of pressed / not pressed buttons with a round mark. */
export function FilterChoices({ label, allLabel, value, choices, onChange }: FilterChoicesProps) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-px">
      {[{ value: undefined, label: allLabel, mark: undefined } as { value: string | undefined; label: ReactNode; mark?: ReactNode }, ...choices].map((choice) => {
        const on = choice.value === value;
        return (
          <button
            key={choice.value ?? ""}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(choice.value)}
            className={cn(
              "flex min-h-9 w-full items-center gap-2.5 rounded-sm px-2 text-start text-sm text-text-secondary hover:bg-hover pointer-coarse:min-h-11",
              on && "font-semibold text-text",
              focusRing,
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px] border-control-border",
                on && "border-primary bg-primary text-on-primary",
              )}
            >
              {on && <Icon name="check" size={12} />}
            </span>
            {choice.mark !== undefined && (
              <span aria-hidden="true" className="inline-flex shrink-0">
                {choice.mark}
              </span>
            )}
            <span className="min-w-0">{choice.label}</span>
          </button>
        );
      })}
    </div>
  );
}
