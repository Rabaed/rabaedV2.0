"use client";

import type { LinkedFromItem, Locale } from "@rabaed/domain";
import { LinkedFromList } from "@rabaed/ui";
import { Link } from "@/i18n/navigation";

// "Linked from", in the Links section below the item's Links (form-engine.md
// part 2b; visibility.md E3): the Submitted items linking here, as the API
// returns them for the viewer. One they can't see comes as its number and
// Subject only, without an id, so it can't be opened.

export function WorkItemLinkedFrom({ items, locale }: { items: readonly LinkedFromItem[]; locale: Locale }) {
  return <LinkedFromList locale={locale} items={items} hrefFor={(id) => `/work-items/${id}`} linkAs={Link} />;
}
