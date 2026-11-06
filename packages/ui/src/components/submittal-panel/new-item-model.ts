import type { BaseRole, BilingualText } from "@rabaed/domain";
import type { IconName } from "../icon/icon.tsx";
import type { SubmittalRoute } from "./route-model.ts";

// The create panel's pure parts (RP-1152), worked out apart from React so they can be tested.

const typeIcons: ReadonlyMap<string, IconName> = new Map<string, IconName>([
  ["MAR", "building-factory"],
  ["SAR", "truck"],
  ["DAR", "file-text"],
  ["WIR", "clipboard-check"],
  ["SNG", "alert-triangle"],
  ["QSC", "shield-check"],
  ["QSN", "shield-check"],
]);

/** A Type card's icon, from the Type's code (RP-1227, RP-1231): a file for a Type without one of its own. */
export function newItemTypeIcon(code: string): IconName {
  return typeIcons.get(code) ?? "file-text";
}

/**
 * A row of the new item's route preview (rows 34, 35; V15): the viewer's own Company's Steps by
 * their Step names, the current one first; every other role's stop one row ("Consultant review",
 * its Steps private); and the closing stop, where the raiser receives the outcome. A row carries
 * a role and, for the viewer's own Steps, a Step name: never a person and never a Company.
 */
export type NewItemRouteRow =
  | { kind: "step"; role: BaseRole; name: BilingualText; current: boolean }
  | { kind: "private"; role: BaseRole }
  | { kind: "outcome"; role: BaseRole };

/**
 * The rows of the preview, from the route the caller computed with the Draft Step as the viewer's
 * own position. The viewer's own role is the role of the stop holding that Step; failing that,
 * the first stop's (the raiser starts the route).
 */
export function newItemRouteRows(route: SubmittalRoute): NewItemRouteRow[] {
  const held = route.steps.find((s) => s.current);
  const own = held ? held.role : route.stops[0]?.role;
  return route.stops.flatMap((stop, i): NewItemRouteRow[] => {
    if (stop.stepKeys.length === 0) return [{ kind: "outcome", role: stop.role }];
    if (stop.role !== own) return [{ kind: "private", role: stop.role }];
    return route.steps.filter((s) => s.stop === i).map((s) => ({ kind: "step", role: s.role, name: s.step.name, current: s.current }));
  });
}

/** A field the Form requires before Send for Review, and whether it is filled. */
export type NewItemRequiredItem = { key: string; label: string; done: boolean };

/** "n/m": how many of the required fields are filled. */
export function newItemRequired(items: readonly NewItemRequiredItem[]): { done: number; total: number } {
  return { done: items.filter((item) => item.done).length, total: items.length };
}
