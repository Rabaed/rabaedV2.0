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

/** The number and Subject of each linked item the viewer sees, by id, to name a link question's choices. */
export const linkTargetNames = (links: readonly WorkItemLink[]): LinkTargetNames =>
  Object.fromEntries(links.flatMap((l) => (l.workItemId ? [[l.workItemId, { documentNumber: l.documentNumber, subject: l.subject }]] : [])));
