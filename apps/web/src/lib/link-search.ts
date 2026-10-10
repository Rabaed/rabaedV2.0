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
 * Where a linked item the viewer can't see opens, by its Document Number: the
 * page of one of the item's Links to it, by the Link's own id (RP-521), never
 * the hidden item's, which the viewer never has. Plain data, so a server page
 * can hand it to the Form.
 */
export const hiddenLinkHrefs = (workItemId: string, links: readonly WorkItemLink[]): Readonly<Record<string, string>> => {
  const byNumber: Record<string, string> = {};
  for (const l of links) if (l.workItemId === null) byNumber[l.documentNumber] ??= `/work-items/${workItemId}/links/${l.id}`;
  return byNumber;
};

/** The number and Subject of each linked item the viewer sees, by id, to name a link question's choices. */
export const linkTargetNames = (links: readonly WorkItemLink[]): LinkTargetNames =>
  Object.fromEntries(links.flatMap((l) => (l.workItemId ? [[l.workItemId, { documentNumber: l.documentNumber, subject: l.subject }]] : [])));
