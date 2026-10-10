import type { Locale, WorkItemList as WorkItemListData, WorkItemRow } from "@rabaed/domain";
import { ownerOf, placesOf } from "./work-item-board.tsx";

/** What the List's rows can be grouped by (RP-409, the owner's design): Status, Discipline, Type, Current owner, Zone, Code. */
export const listGroupings = ["stage", "trade", "type", "owner", "locationLevel1", "outcome"] as const;
export type ListGrouping = (typeof listGroupings)[number];

/** One group: its key, its name (null for the rows with no value, which come last), and its rows in the page's order. */
export type ListGroup = { key: string; label: string | null; rows: WorkItemRow[] };

type Filters = Pick<WorkItemListData, "stages"> & Pick<WorkItemListData["filters"], "trades" | "locations" | "outcomes">;
type Labels = { code: (code: string) => string; cancelled: string; unclaimed: string };

/**
 * The page's rows in groups, each in its own order: Stages, Trades and Locations as the Project
 * orders them, outcomes as their Type's set, Types and owners by name. The owner is who the row
 * shows (V14). Rows with no value come last, in one group with no name.
 */
export function groupRows(rows: WorkItemRow[], by: ListGrouping, filters: Filters, locale: Locale, labels: Labels): ListGroup[] {
  const places = placesOf(filters.locations);
  const valueOf = (row: WorkItemRow): { key: string; label: string; order: number | string } | null => {
    switch (by) {
      case "stage":
        return { key: row.stage.key, label: row.stage.name[locale], order: filters.stages.findIndex((s) => s.key === row.stage.key) };
      case "trade":
        return { key: row.trade.id, label: `${row.trade.name[locale]} (${row.trade.code})`, order: filters.trades.findIndex((t) => t.id === row.trade.id) };
      case "type":
        return { key: row.type.code, label: row.type.code, order: row.type.code };
      case "owner": {
        const owner = ownerOf(row, locale, labels);
        return owner ? { key: `${owner.kind}:${owner.name}`, label: owner.name, order: owner.name.toLocaleLowerCase() } : null;
      }
      case "locationLevel1": {
        const top = row.location === null ? undefined : places.get(row.location.id)?.find((p) => p.depth === 1);
        if (!top) return null;
        const at = filters.locations.findIndex((l) => l.depth === 1 && l.name.en === top.name.en);
        return { key: `zone:${top.name.en}`, label: top.name[locale], order: at };
      }
      case "outcome": {
        if (row.outcome === null) return null;
        if (row.outcome === "cancelled") return { key: "cancelled", label: labels.cancelled, order: Number.MAX_SAFE_INTEGER };
        const at = filters.outcomes.findIndex((o) => o.code === row.outcome);
        return { key: row.outcome, label: row.outcome.length <= 3 ? labels.code(row.outcome) : (filters.outcomes[at]?.name[locale] ?? row.outcome), order: at };
      }
    }
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
