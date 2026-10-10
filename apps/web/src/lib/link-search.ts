import type { LinkSearchResults, WorkItemLink } from "@rabaed/domain";
import type { LinkTargetNames } from "@rabaed/ui";

/** Link search on one Project, through the API (only Submitted items the Member sees). */
export const linkSearch =
  (projectId: string) =>
  async (q: string, page: number): Promise<LinkSearchResults> => {
    const query = new URLSearchParams({ q, page: String(page) });
    const res = await fetch(`/api/v1/projects/${projectId}/work-items/link-search?${query.toString()}`);
    if (!res.ok) throw new Error(`Link search: ${res.status}`);
    return (await res.json()) as LinkSearchResults;
  };

/**
 * Where one of an item's Links opens: the linked item, when the viewer sees it;
 * otherwise the Link's own page, by the Link's id through the item it is linked
 * from (RP-521), never the hidden item's id, which the viewer never has.
 */
export const linkHref = (workItemId: string, link: WorkItemLink): string =>
  link.workItemId ? `/work-items/${link.workItemId}` : `/work-items/${workItemId}/links/${link.id}`;

/**
 * Where a linked item the viewer can't see opens, by its Document Number: the
 * page of the item's first Link to it (`linkHref`). Plain data, so a server page
 * can hand it to the Form's link questions.
 */
export const hiddenLinkHrefs = (workItemId: string, links: readonly WorkItemLink[]): Readonly<Record<string, string>> => {
  const byNumber: Record<string, string> = {};
  for (const l of links) if (l.workItemId === null) byNumber[l.documentNumber] ??= linkHref(workItemId, l);
  return byNumber;
};

/** The number and Subject of each linked item the viewer sees, by id, to name a link question's choices. */
export const linkTargetNames = (links: readonly WorkItemLink[]): LinkTargetNames =>
  Object.fromEntries(links.flatMap((l) => (l.workItemId ? [[l.workItemId, { documentNumber: l.documentNumber, subject: l.subject }]] : [])));
