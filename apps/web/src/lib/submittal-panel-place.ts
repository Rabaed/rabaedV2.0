import type { BilingualText, Locale, WorkItemList } from "@rabaed/domain";
import { placesOf } from "@rabaed/ui";

type Locations = WorkItemList["filters"]["locations"];

/** Each level's code on the way to `id`, top level first; empty when the List doesn't hold it. */
function codesOf(id: string, locations: Locations): string[] {
  const byId = new Map(locations.map((l) => [l.id, l]));
  const codes: string[] = [];
  const seen = new Set<string>();
  for (let at = byId.get(id); at && !seen.has(at.id); at = at.parentId ? byId.get(at.parentId) : undefined) {
    seen.add(at.id);
    codes.unshift(at.code);
  }
  return codes;
}

/**
 * The open item's place in the Submittal Panel (RP-1065): `shown`, for the Location section and
 * the identity, is its Location path as the List's locations name it, top level first, or its
 * own place alone when the List doesn't hold the path; `numbered`, for the number card, is the
 * path only, so a Location part is never explained with another level's name; `codes`, for the
 * Location fact (RP-1237 row 10), is each level's code on that path, empty without it.
 */
export function submittalPanelPlace(
  location: { id: string; name: BilingualText } | null,
  locations: Locations,
  locale: Locale,
): { shown: string[]; numbered: string[]; codes: string[] } {
  if (!location) return { shown: [], numbered: [], codes: [] };
  const path = placesOf(locations)
    .get(location.id)
    ?.map((p) => p.name[locale]);
  return path ? { shown: path, numbered: path, codes: codesOf(location.id, locations) } : { shown: [location.name[locale]], numbered: [], codes: [] };
}
