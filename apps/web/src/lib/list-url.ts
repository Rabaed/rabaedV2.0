import { workItemListPageSize, workItemQueryFromSearchParams, workItemSearchParams, type WorkItemQuery } from "@rabaed/domain";

// The List's URL (RP-409): the work item query with a numbered page. It opens at the first page
// of 25 rows, sorted by the Document Number ("Submittal No."), as the owner's design draws it; those
// defaults stay out of the URL. The work item query's own default sort, the Step Age, is then
// named in the URL when chosen. An old link's cursor is ignored: the List pages by number.

type SearchParamsLike = URLSearchParams | Record<string, string | string[] | undefined>;

const listSort: WorkItemQuery["sort"] = "documentNumber";

const has = (params: SearchParamsLike, key: string) => (params instanceof URLSearchParams ? params.has(key) : params[key] !== undefined);

/** The List's query from its URL: its page, size and sort filled in. */
export function listQueryFromSearchParams(params: SearchParamsLike): WorkItemQuery {
  const query = workItemQueryFromSearchParams(params);
  return {
    ...query,
    cursor: undefined,
    sort: has(params, "sort") ? query.sort : listSort,
    page: query.page ?? 1,
    pageSize: query.pageSize ?? workItemListPageSize,
  };
}

/** The URL query of the List showing `query`, its defaults left out. */
export function listSearchParams(query: Partial<WorkItemQuery>): URLSearchParams {
  const params = workItemSearchParams({
    ...query,
    cursor: undefined,
    lang: undefined,
    page: query.page === 1 ? undefined : query.page,
    pageSize: query.pageSize === workItemListPageSize ? undefined : query.pageSize,
  });
  if (query.sort === "stepAge") params.set("sort", "stepAge");
  if (query.sort === listSort) params.delete("sort");
  return params;
}
