/**
 * The Submittal Panel's place in the URL (RP-1061): `?open=<id>` on the List and the Kanban, so
 * a reload or a shared link reopens it. The rest of the page's query (filters, page, view) is kept.
 */
const openParam = "open";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The page's URL with `id` open in the panel, or with the panel closed (null). */
export function submittalPanelHref(pathname: string, search: string, id: string | null): string {
  const params = new URLSearchParams(search);
  if (id === null) params.delete(openParam);
  else params.set(openParam, id);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** The item the URL opens: only an id that can be an item's, so an edited link asks the api nothing else. */
export function openIdFrom(params: Pick<URLSearchParams, "get">): string | null {
  const id = params.get(openParam);
  return id !== null && uuid.test(id) ? id : null;
}
