import type { WorkItemLink } from "@rabaed/domain";
import type { SubmittalPanelLinkItem } from "@rabaed/ui";
import { linkHref } from "./link-search.ts";

/**
 * The Submittal Panel's Links section (RP-1066): each Link the Links read gives, as its number,
 * its Subject and where it opens (`linkHref`). A linked item the viewer can't see has no id in the
 * read, so it opens on the Link's own page (Links row, RP-521) and nothing else of it is kept.
 */
export function submittalPanelLinks(workItemId: string, links: readonly WorkItemLink[]): SubmittalPanelLinkItem[] {
  return links.map((link) => ({ id: link.id, documentNumber: link.documentNumber, subject: link.subject, href: linkHref(workItemId, link) }));
}
