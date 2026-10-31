import type { BilingualText, Locale, WorkItemList } from "@rabaed/domain";
import { placesOf } from "@rabaed/ui";

/**
 * The open item's place in the Submittal Panel (RP-1065): `shown`, for the Location section and
 * the identity, is its Location path as the List's locations name it, top level first, or its
 * own place alone when the List doesn't hold the path; `numbered`, for the number card, is the
 * path only, so a Location part is never explained with another level's name.
 */
export function submittalPanelPlace(
  location: { id: string; name: BilingualText } | null,
  locations: WorkItemList["filters"]["locations"],
  locale: Locale,
): { shown: string[]; numbered: string[] } {
  if (!location) return { shown: [], numbered: [] };
  const path = placesOf(locations)
    .get(location.id)
    ?.map((p) => p.name[locale]);
  return path ? { shown: path, numbered: path } : { shown: [location.name[locale]], numbered: [] };
}
