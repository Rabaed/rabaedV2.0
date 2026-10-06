"use client";

import {
  directionOf,
  formatNumber,
  formatTableCell,
  isUnanswered,
  maxTableRows,
  tableTotals,
  type FieldError,
  type FormRow,
  type FormValue,
  type Locale,
  type OptionList,
  type TableColumn,
  type TableField,
} from "@rabaed/domain";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Button, IconButton } from "../button/button.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../data/table.tsx";
import { Field, useFieldControl, type FieldControlProps } from "../form/field.tsx";
import { Icon } from "../icon/icon.tsx";

// The `table` field (form-engine.md §2): rows of typed columns. In edit mode
// each row is a labelled group of fields, so it stays usable at phone width
// (no sideways scrolling to reach a cell); in read mode it is a real table, in
// the item's own Form order. Totals sit under it for the columns that ask for
// one. Presentational only, like the renderer around it: the cell controls come
// from the renderer, and errors from the shared validator.

/* eslint-disable rabaed/no-ui-translations -- existing labels, still to move to the app's messages (RP-362 retro) */
const copy = {
  en: {
    addRow: "Add row",
    row: (n: number) => `Row ${formatNumber(n, "en")}`,
    removeRow: (n: number) => `Remove row ${formatNumber(n, "en")}`,
    noRows: "No rows yet.",
    limitReached: (max: number) => `The most rows allowed is ${formatNumber(max, "en")}.`,
    total: (column: string) => `Total ${column}`,
    wrongType: "This row isn't valid here.",
  },
  ar: {
    addRow: "إضافة صف",
    row: (n: number) => `الصف ${formatNumber(n, "ar")}`,
    removeRow: (n: number) => `حذف الصف ${formatNumber(n, "ar")}`,
    noRows: "لا توجد صفوف بعد.",
    limitReached: (max: number) => `أقصى عدد للصفوف هو ${formatNumber(max, "ar")}.`,
    total: (column: string) => `إجمالي ${column}`,
    wrongType: "هذا الصف غير صالح هنا.",
  },
} satisfies Record<Locale, unknown>;
/* eslint-enable rabaed/no-ui-translations */

const isRowObject = (value: unknown): value is FormRow => typeof value === "object" && value !== null && !Array.isArray(value);

/** A table answer's rows; anything that isn't a row (an invalid answer on its way to the validator) reads as an empty one. */
export const rowsOf = (value: unknown): FormRow[] => (Array.isArray(value) ? value.map((row) => (isRowObject(row) ? row : {})) : []);

const isNumeric = (column: TableColumn) => column.type === "number" || column.type === "currency";

/** The totals under a table, one line per column that asks for one: "Total Quantity: 42". */
function Totals({ field, rows, locale }: { field: TableField; rows: FormRow[]; locale: Locale }) {
  const totals = tableTotals(field, rows);
  const columns = field.columns.filter((c) => (c.type === "number" || c.type === "currency") && c.total);
  if (columns.length === 0 || rows.length === 0) return null;
  return (
    // Read out as the rows change, so a filler hears the new total.
    <dl aria-live="polite" className="flex flex-wrap gap-x-6 gap-y-1 text-body">
      {columns.map((column) => (
        <div key={column.key} className="flex gap-2">
          <dt className="font-medium text-muted">{copy[locale].total(column.label[locale])}</dt>
          <dd className="font-semibold text-text">
            <bdi dir={directionOf(locale)}>{formatTableCell(column, totals[column.key] ?? 0, locale)}</bdi>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export type TableCellControl = (
  column: TableColumn,
  row: number,
  value: unknown,
  change: (value: FormValue | undefined) => void,
) => { element: ReactNode; group?: boolean };

/**
 * The table in edit mode: a labelled group of rows, each a group of fields (one
 * per column) with a remove button, then "Add row" and the totals. `errors` are
 * this table's cell errors; `cellError` words one. Adding a row moves focus to
 * its first field, and removing one back to "Add row", so a keyboard user keeps their place.
 */
export function TableInput({
  field,
  value,
  locale,
  errors,
  cell,
  cellError,
  onChange,
}: {
  field: TableField;
  value: unknown;
  locale: Locale;
  errors: readonly FieldError[];
  cell: TableCellControl;
  cellError: (column: TableColumn, error: FieldError) => string;
  onChange: (rows: FormRow[] | undefined) => void;
}) {
  const text = copy[locale];
  const generated = useId();
  const { id = `table${generated.replaceAll(":", "")}`, labelId, "aria-describedby": describedBy } = useFieldControl<FieldControlProps>({});
  const rows = rowsOf(value);
  const limit = field.maxRows ?? maxTableRows;
  const atLimit = rows.length >= limit;
  const container = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<"new_row" | "add_row" | null>(null);

  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === "new_row") {
      container.current?.querySelector<HTMLElement>(`[data-row="${rows.length - 1}"] :is(input, button[role=combobox], button[role=radio])`)?.focus();
    } else if (target === "add_row") addButton.current?.focus();
  }, [rows.length]);

  const update = (next: FormRow[]) => onChange(next.length === 0 ? undefined : next);
  const setCell = (row: number, key: string, cellValue: FormValue | undefined) =>
    update(
      rows.map((r, i) => {
        if (i !== row) return r;
        const { [key]: _old, ...rest } = r;
        return cellValue === undefined ? rest : { ...rest, [key]: cellValue as string | number | boolean };
      }),
    );

  return (
    <div ref={container} id={id} role="group" aria-labelledby={labelId} aria-describedby={describedBy} className="flex flex-col gap-3">
      {rows.length === 0 && <p className="text-body text-muted">{text.noRows}</p>}
      {rows.map((row, i) => {
        const rowError = errors.find((e) => e.row === i && e.column === undefined);
        return (
          <div
            key={i}
            role="group"
            aria-label={text.row(i + 1)}
            data-row={i}
            className="flex items-start gap-2 rounded-md border border-border bg-surface-subtle p-3"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              {rowError && (
                <p className="flex items-start gap-1 text-sm text-danger">
                  <Icon name="alert-circle" size={16} className="mt-0.5" />
                  <span>{text.wrongType}</span>
                </p>
              )}
              <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
                {field.columns.map((column) => {
                  const error = errors.find((e) => e.row === i && e.column === column.key);
                  const { element, group } = cell(column, i, row[column.key], (v) => setCell(i, column.key, v));
                  return (
                    <Field
                      key={column.key}
                      id={`${id}-r${i}-${column.key}`}
                      label={column.label[locale]}
                      required={column.required}
                      error={error && cellError(column, error)}
                      group={group}
                    >
                      {element}
                    </Field>
                  );
                })}
              </div>
            </div>
            <IconButton
              label={text.removeRow(i + 1)}
              onClick={() => {
                focusNext.current = "add_row";
                update(rows.filter((_, r) => r !== i));
              }}
            >
              <Icon name="trash" size={16} />
            </IconButton>
          </div>
        );
      })}
      <Totals field={field} rows={rows} locale={locale} />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          ref={addButton}
          variant="secondary"
          size="sm"
          disabled={atLimit}
          onClick={() => {
            focusNext.current = "new_row";
            update([...rows, {}]);
          }}
        >
          <Icon name="plus" size={16} />
          {text.addRow}
        </Button>
        {atLimit && <span className="text-sm text-muted">{text.limitReached(limit)}</span>}
      </div>
    </div>
  );
}

/** The table in read mode: a real table of the rows as submitted, with the totals under it. */
export function TableRead({
  field,
  value,
  locale,
  optionLists,
}: {
  field: TableField;
  value: unknown;
  locale: Locale;
  optionLists?: readonly OptionList[];
}) {
  const rows = rowsOf(value).filter((row) => !Object.values(row).every(isUnanswered));
  return (
    <div className="flex flex-col gap-3">
      <Table label={field.label[locale]}>
        <TableHeader>
          <TableRow>
            {field.columns.map((column) => (
              <TableHead key={column.key} align={isNumeric(column) ? "end" : "start"}>
                {column.label[locale]}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {field.columns.map((column) => (
                <TableCell key={column.key} align={isNumeric(column) ? "end" : "start"} className={cn(isNumeric(column) && "tabular-nums")}>
                  {/* A number reads in the page's direction so its unit follows it; text keeps its own. */}
                  <bdi dir={isNumeric(column) ? directionOf(locale) : undefined}>{formatTableCell(column, row[column.key], locale, optionLists)}</bdi>
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Totals field={field} rows={rows} locale={locale} />
    </div>
  );
}
