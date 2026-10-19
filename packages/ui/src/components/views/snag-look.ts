import type { Locale, WorkItemRow } from "@rabaed/domain";
import type { IconName } from "../icon/icon.tsx";
import type { placesOf } from "./work-item-board.tsx";

// What the Snag List's views share, desktop (RP-94) and phone (RP-630).

/** How a Type's chip looks: a shape and a colour, never colour alone. A Type the app doesn't know (a Project Type) is a neutral chip. */
const typeLooks: Record<string, { icon: IconName; classes: string; mark: string }> = {
  SNG: { icon: "alert-triangle", classes: "bg-danger-tint text-danger-fg", mark: "text-danger" },
  OBS: { icon: "eye", classes: "bg-warning-tint text-warning-fg", mark: "text-warning-fg" },
  QST: { icon: "help-circle", classes: "bg-segment-type-tint text-segment-type-fg", mark: "text-segment-type-solid" },
  CMT: { icon: "message-circle", classes: "bg-info-tint text-info-fg", mark: "text-info-fg" },
};
const otherType = { icon: "tag" as IconName, classes: "bg-neutral-tint text-neutral-fg", mark: "text-muted" };
export const lookOf = (code: string) => typeLooks[code] ?? otherType;

export type Places = ReturnType<typeof placesOf>;

/** An item's Location as the last two places of the path down to it, as the design reads it, e.g. "Tower 1 · Floor 02". */
export function placeText(row: WorkItemRow, places: Places, locale: Locale): string | null {
  if (row.location === null) return null;
  const path = places.get(row.location.id) ?? [{ depth: 1, name: row.location.name }];
  return [...path]
    .sort((a, b) => a.depth - b.depth)
    .slice(-2)
    .map((p) => p.name[locale])
    .join(" · ");
}
