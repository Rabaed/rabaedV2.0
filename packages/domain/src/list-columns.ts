import { z } from "zod";
import type { WorkItemSort } from "./work-item-query.ts";

/**
 * The List's columns (RP-409, the owner's design), in their first order. Each sorts by the work item
 * query's sort of the same name. The design's "Due date" is left out (Rabaed shows no due dates), and
 * its "Days in column" is the Step Age. `locationLevel1`…`3` are the Zone, Building and Floor.
 */
export const listColumnKeys = [
  "documentNumber",
  "subject",
  "revision",
  "trade",
  "type",
  "stage",
  "outcome",
  "locationLevel1",
  "locationLevel2",
  "locationLevel3",
  "owner",
  "contractor",
  "created",
  "stepAge",
] as const satisfies readonly WorkItemSort[];
export type ListColumnKey = (typeof listColumnKeys)[number];

/** Always shown, and first: the Document Number and the Subject. */
export const lockedListColumns: readonly ListColumnKey[] = ["documentNumber", "subject"];
/** Hidden until the Member shows them. */
const hiddenByDefault: readonly ListColumnKey[] = ["contractor", "stepAge"];

/** The columns in their order, each shown or not: a Member's own List layout. */
export const listColumnLayout = z
  .array(z.object({ key: z.enum(listColumnKeys), shown: z.boolean() }))
  .max(listColumnKeys.length)
  .refine((columns) => new Set(columns.map((c) => c.key)).size === columns.length, "Each column once");
export type ListColumnLayout = z.infer<typeof listColumnLayout>;

export const defaultListColumns: ListColumnLayout = listColumnKeys.map((key) => ({ key, shown: !hiddenByDefault.includes(key) }));

/**
 * A layout as the List shows it: the locked columns first and shown, then the others in the saved
 * order, and any column the saved layout lacks (one added since) in its first place, as it starts.
 */
export function listColumns(saved: ListColumnLayout | null | undefined): ListColumnLayout {
  const given = (saved ?? []).filter((c) => !lockedListColumns.includes(c.key));
  const out: ListColumnLayout = lockedListColumns.map((key) => ({ key, shown: true }));
  for (const column of defaultListColumns) {
    if (lockedListColumns.includes(column.key) || given.some((c) => c.key === column.key)) continue;
    // A column the layout lacks goes after the one before it in the first order.
    const before = listColumnKeys[listColumnKeys.indexOf(column.key) - 1];
    const at = given.findIndex((c) => c.key === before);
    given.splice(at === -1 ? 0 : at + 1, 0, column);
  }
  return [...out, ...given];
}
