import type { Locale, WorkItemList as WorkItemListData, WorkItemRow } from "@rabaed/domain";
import { ownerOf, placesOf } from "./work-item-board.tsx";
import { cellText, type CellTextLabels } from "./work-item-table.tsx";

/** What the List's rows can be grouped by (RP-409, the owner's design): Status, Discipline, Type, Current owner, Zone, Code. */
export const listGroupings = ["stage", "trade", "type", "owner", "locationLevel1", "outcome"] as const;
export type ListGrouping = (typeof listGroupings)[number];

/** One group: its key, its name (null for the rows with no value, which come last), and its rows in the page's order. */
export type ListGroup = { key: string; label: string | null; rows: WorkItemRow[] };

type Filters = Pick<WorkItemListData, "stages"> & Pick<WorkItemListData["filters"], "trades" | "locations" | "outcomes">;

/**
 * The page's rows in groups, each in its own order: Stages, Trades and Locations as the Project
 * orders them, outcomes as their Type's set, Types and owners by name. The owner is who the row
 * shows (V14). Rows with no value come last, in one group with no name.
 */
export function groupRows(rows: WorkItemRow[], by: ListGrouping, filters: Filters, locale: Locale, labels: CellTextLabels): ListGroup[] {
  const places = placesOf(filters.locations);
  // A group's name is its rows' cell, as the table and Export say it (cellText); only its key and order are the group's own.
  const keyOf = (row: WorkItemRow): { key: string; order: number | string } | null => {
    switch (by) {
      case "stage":
        return { key: row.stage.key, order: filters.stages.findIndex((s) => s.key === row.stage.key) };
      case "trade":
        return { key: row.trade.id, order: filters.trades.findIndex((t) => t.id === row.trade.id) };
      case "type":
        return { key: row.type.code, order: row.type.code };
      case "owner": {
        const owner = ownerOf(row, locale, labels);
        return owner ? { key: `${owner.kind}:${owner.name}`, order: owner.name.toLocaleLowerCase() } : null;
      }
      case "locationLevel1": {
        const top = row.location === null ? undefined : places.get(row.location.id)?.find((p) => p.depth === 1);
        if (!top) return null;
        return { key: `zone:${top.name.en}`, order: filters.locations.findIndex((l) => l.depth === 1 && l.name.en === top.name.en) };
      }
      case "outcome":
        if (row.outcome === null) return null;
        if (row.outcome === "cancelled") return { key: "cancelled", order: Number.MAX_SAFE_INTEGER };
        return { key: row.outcome, order: filters.outcomes.findIndex((o) => o.code === row.outcome) };
    }
  };
  const valueOf = (row: WorkItemRow) => {
    const key = keyOf(row);
    return key && { ...key, label: cellText(by, row, locale, labels, filters, places) };
  };
  const groups = new Map<string, ListGroup & { order: number | string }>();
  const none: ListGroup = { key: "none", label: null, rows: [] };
  for (const row of rows) {
    const value = valueOf(row);
    if (!value) {
      none.rows.push(row);
      continue;
    }
    const group = groups.get(value.key) ?? { key: value.key, label: value.label, rows: [], order: value.order };
    group.rows.push(row);
    groups.set(value.key, group);
  }
  const sorted = [...groups.values()].sort((a, b) =>
    typeof a.order === "number" && typeof b.order === "number" ? a.order - b.order : String(a.order).localeCompare(String(b.order), locale),
  );
  return [...sorted.map(({ order: _order, ...group }) => group), ...(none.rows.length > 0 ? [none] : [])];
}
