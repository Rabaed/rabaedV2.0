"use client";

import type { LinkedFromItem } from "@rabaed/domain";
import { LinkedFromList } from "@rabaed/ui";
import { useLinkedFromLabels } from "@/lib/form-labels";
import { Link } from "@/i18n/navigation";

// "Linked from", in the Links section below the item's Links (form-engine.md
// part 2b; visibility.md E3, RP-1301): the Submitted items linking here that the
// viewer sees, as the API returns them; each opens its item. One they can't see
// is never in the read.

export function WorkItemLinkedFrom({ items, look }: { items: readonly LinkedFromItem[]; look?: "rows" }) {
  const labels = useLinkedFromLabels();
  return <LinkedFromList labels={labels} items={items} hrefFor={(id) => `/work-items/${id}`} linkAs={Link} {...(look ? { look } : {})} />;
}
