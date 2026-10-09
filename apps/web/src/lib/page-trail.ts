import { decodeWorkItemCursor, workItemSearchParams, type WorkItemQuery } from "@rabaed/domain";

// The List's pages are cursors, forward only (the API's work item query). To
// go back and to number a page, the List's URL also keeps the pages before it:
// `page` (its number, from 2) and `before` (the cursor of each page from the
// second to the one before this, oldest first). The API never sees them.

type SearchParamsLike = URLSearchParams | Record<string, string | string[] | undefined>;

const all = (params: SearchParamsLike, key: string): string[] => {
  if (params instanceof URLSearchParams) return params.getAll(key);
  const v = params[key];
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
};

/** The URL query of the List showing `query`, with the pages before it when it isn't the first. */
export function workItemListSearchParams(query: Partial<WorkItemQuery>, trail?: readonly string[]): URLSearchParams {
  const params = workItemSearchParams(query);
  if (query.cursor !== undefined && trail !== undefined) {
    params.set("page", String(trail.length + 2));
    for (const cursor of trail) params.append("before", cursor);
  }
  return params;
}

/**
 * The pages before the one the URL shows, or undefined when the URL doesn't
 * say (a later page linked from elsewhere) or says something that doesn't add
 * up: then the List shows no page number and no Previous.
 */
export function pageTrailFromSearchParams(params: SearchParamsLike, query: WorkItemQuery): readonly string[] | undefined {
  if (query.cursor === undefined) return undefined;
  const page = Number(all(params, "page")[0]);
  const before = all(params, "before");
  if (!Number.isInteger(page) || page !== before.length + 2) return undefined;
  return before.every((cursor) => decodeWorkItemCursor(cursor, query.sort) !== null) ? before : undefined;
}
