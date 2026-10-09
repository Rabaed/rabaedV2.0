"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import { useId, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { useMediaQuery } from "../../lib/use-media-query.ts";
import { Button } from "../button/button.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Icon } from "../icon/icon.tsx";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "../overlay/popover.tsx";
import { Sheet, SheetClose, SheetContent, SheetFooter, SheetTrigger } from "../overlay/sheet.tsx";
import { toolbarButton } from "./list-toolbar.tsx";

// The Filters button of a data list page and what it opens (kit
// `list/filter-panel.js`, RP-409): from `md` a popover with the fields on the
// start side and the chosen field's values beside them; below `md` a sheet
// with every field one under the other. Each choice applies at once (the page
// keeps it in its URL); Done only closes.

export type FilterMenuField = {
  key: string;
  label: string;
  /** How many of its values are chosen: shown beside its name, and a field with any counts as one filter applied. */
  count: number;
  /** Its values, e.g. `FilterChoices`, or a date range. */
  content: ReactNode;
};

export type FilterMenuLabels = {
  /** The button's and the panel's name, e.g. "Filters". */
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
  /** The field shown first in the popover; defaults to the first. */
  initialField?: string;
};

/** The Filters button with the number of filters applied, opening the filters. */
export function FilterMenu({ fields, labels, onClearAll, initialField }: FilterMenuProps) {
  const wide = useMediaQuery("(min-width: 48rem)");
  const applied = fields.filter((f) => f.count > 0).length;
  const trigger = (
    <button type="button" className={cn(toolbarButton, applied > 0 && "bg-brand-tint text-brand-fg hover:bg-brand-tint active:bg-brand-tint data-[state=open]:bg-brand-tint")}>
      <Icon name="filter" />
      {labels.filters}
      {/* The space keeps the name "Filters 2" for screen readers. */}
      {applied > 0 && " "}
      {applied > 0 && (
        <span className="min-w-5 rounded-full bg-primary px-1.5 text-center font-ui text-notes leading-5 font-bold text-on-primary">
          {labels.number(applied)}
        </span>
      )}
      <Icon name="chevron-down" />
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
      <PopoverContent aria-label={labels.filters} className="w-[37.5rem] rounded-md p-0 shadow-lg">
        <FieldTabs fields={fields} number={labels.number} initialField={initialField} label={labels.filters} />
        <div className="flex items-center justify-between gap-3 rounded-b-md border-t border-border bg-surface-subtle px-4 py-2.5">
          {footerLine}
          <div className="flex gap-2">
            {onClearAll && (
              <Button variant="ghost" size="sm" disabled={applied === 0} onClick={onClearAll}>
                {labels.clearAll}
              </Button>
            )}
            <PopoverClose asChild>
              <Button size="sm">{labels.done}</Button>
            </PopoverClose>
          </div>
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
      <span className="ms-auto min-w-5 rounded-full bg-primary px-1.5 text-center text-notes leading-5 font-bold text-on-primary">{number(count)}</span>
    </>
  );
}

/** The popover's body: the fields as vertical tabs, the chosen one's values beside them. */
function FieldTabs({ fields, number, initialField, label }: { fields: FilterMenuField[]; number: (n: number) => string; initialField?: string; label: string }) {
  const [current, setCurrent] = useState(initialField ?? fields[0]?.key ?? "");
  return (
    <TabsPrimitive.Root value={current} onValueChange={setCurrent} orientation="vertical" className="grid min-h-80 grid-cols-[13rem_minmax(0,1fr)]">
      <TabsPrimitive.List aria-label={label} className="flex flex-col gap-px border-e border-border p-2">
        {fields.map((field) => (
          <TabsPrimitive.Trigger
            key={field.key}
            value={field.key}
            className={cn(
              "flex min-h-9 items-center gap-2 rounded-sm px-2.5 text-start text-sm text-text-secondary hover:bg-hover",
              "data-[state=active]:bg-brand-tint data-[state=active]:font-semibold data-[state=active]:text-brand-fg",
              focusRing,
            )}
          >
            {field.label}
            <CountPill count={field.count} number={number} />
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {fields.map((field) => (
        <TabsPrimitive.Content key={field.key} value={field.key} className={cn("flex max-h-96 min-w-0 flex-col overflow-y-auto p-3", focusRing)}>
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
        {field.label}
        <CountPill count={field.count} number={number} />
      </h3>
      {field.content}
    </section>
  );
}

export type FilterChoice = {
  value: string;
  label: ReactNode;
  /** A mark before the label, e.g. a Stage's dot or Step Age dots. Decorative. */
  mark?: ReactNode;
};

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
