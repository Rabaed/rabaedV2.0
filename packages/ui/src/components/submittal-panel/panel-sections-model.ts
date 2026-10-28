import { formatFormValue, formatTableCell, formFields, type FormAnswers, type FormSchema, type Locale, type OptionList, type SupplierChoice } from "@rabaed/domain";

/**
 * The Submittal Panel's Details tab (RP-1066, spec RP-1054): its fixed sections (owner decision
 * C5), Collapse all / Expand all, and which tab is open. Plain data, so the panel and its host
 * agree on it and it is tested on its own.
 */

/**
 * The fixed sections, in the design's order (README §4.8). Links only, since Subtasks aren't built
 * (decision C2). Attachments (RP-1068) and the in-flow Workflow & approval log (RP-1067) slot in as
 * further sections of their own.
 */
export const submittalPanelSectionOrder = ["subject", "scope", "location", "supplier", "links"] as const;
export type SubmittalPanelSectionKey = (typeof submittalPanelSectionOrder)[number];

/**
 * The fixed sections this item's Form has data for: a section the Type's Form has no field for is
 * hidden (a DAR has no supplier). The Subject and Links are System Fields, on every item.
 */
export function submittalPanelSectionKeys(schema: FormSchema): SubmittalPanelSectionKey[] {
  const types = new Set(formFields(schema).map((f) => f.type));
  const has: Record<SubmittalPanelSectionKey, boolean> = {
    subject: true,
    scope: types.has("trade") || types.has("scopes"),
    location: types.has("location"),
    supplier: types.has("approved_supplier"),
    links: true,
  };
  return submittalPanelSectionOrder.filter((key) => has[key]);
}

/** Every shown section is folded: the button then offers Expand all. A section not shown here doesn't count. */
export function allSubmittalPanelSectionsCollapsed(shown: readonly string[], collapsed: Readonly<Record<string, boolean>>): boolean {
  return shown.length > 0 && shown.every((key) => collapsed[key] === true);
}

/** Folds (`fold`) or opens every shown section, keeping what is kept for the sections another Type shows. */
export function withAllSubmittalPanelSections(shown: readonly string[], collapsed: Readonly<Record<string, boolean>>, fold: boolean): Record<string, boolean> {
  return { ...collapsed, ...Object.fromEntries(shown.map((key) => [key, fold])) };
}

/** The open tab: the kept one while this item offers it, else the first (Details). */
export function submittalPanelTab(kept: string, offered: readonly string[]): string {
  return offered.includes(kept) ? kept : (offered[0] ?? kept);
}

/**
 * How many events of the history the viewer reads are internal. The history read gives internal
 * events only within the viewer's own Participant (V5), so a count of 0 means their Participant
 * has no internal history on the item, and the Internal Communication tab is not offered.
 */
export function submittalPanelInternalCount(events: readonly { audience: "shared" | "internal" }[]): number {
  return events.filter((e) => e.audience === "internal").length;
}

export type SubmittalPanelItemsTable = {
  key: string;
  label: string;
  columns: { key: string; label: string; numeric: boolean }[];
  /** Each row's cells as the viewer reads them, in column order. */
  rows: string[][];
};

export type SubmittalPanelSupplier = {
  /** The Approved Suppliers named, by name only (V10); one the list doesn't name is left out, never shown as an id. */
  suppliers: string[];
  tables: SubmittalPanelItemsTable[];
  /** The rows of every items table. */
  itemCount: number;
};

const numericColumns = new Set(["number", "currency"]);

/**
 * Supplier & items: the Form's Approved Supplier answers by name, and its tables as the items.
 * A Form with no Approved Supplier has none (a supplier request's past projects are no items).
 */
export function submittalPanelSupplier(
  schema: FormSchema,
  answers: FormAnswers,
  suppliers: readonly SupplierChoice[],
  locale: Locale,
  optionLists: readonly OptionList[] = [],
): SubmittalPanelSupplier {
  const fields = formFields(schema);
  if (!fields.some((f) => f.type === "approved_supplier")) return { suppliers: [], tables: [], itemCount: 0 };
  const names: string[] = [];
  const tables: SubmittalPanelItemsTable[] = [];
  for (const field of fields) {
    if (field.type === "approved_supplier") {
      const name = formatFormValue(field, answers[field.key], locale, undefined, optionLists, {}, suppliers);
      if (name) names.push(name);
    } else if (field.type === "table") {
      const value = answers[field.key];
      const rows = Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null) : [];
      tables.push({
        key: field.key,
        label: field.label[locale],
        columns: field.columns.map((c) => ({ key: c.key, label: c.label[locale], numeric: numericColumns.has(c.type) })),
        rows: rows.map((row) => field.columns.map((c) => formatTableCell(c, row[c.key], locale, optionLists))),
      });
    }
  }
  return { suppliers: names, tables, itemCount: tables.reduce((n, t) => n + t.rows.length, 0) };
}
