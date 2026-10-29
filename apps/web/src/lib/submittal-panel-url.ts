import { submittalPanelSizes, type SubmittalPanelWidth } from "@rabaed/ui";

/**
 * The Submittal Panel's place in the URL (RP-1061): `?open=<id>` on the List and the Kanban, so
 * a reload or a shared link reopens it. The rest of the page's query (filters, page, view) is kept.
 * A link may also set the panel's size (`&size=wide`, RP-1063): that view is the link's, so the
 * panel never keeps it as the viewer's own, and closing the panel drops it.
 */
const openParam = "open";
const sizeParam = "size";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The page's URL with `id` open in the panel, or with the panel closed (null). */
export function submittalPanelHref(pathname: string, search: string, id: string | null): string {
  const params = new URLSearchParams(search);
  if (id === null) {
    params.delete(openParam);
    params.delete(sizeParam);
  } else params.set(openParam, id);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** The item the URL opens: only an id that can be an item's, so an edited link asks the api nothing else. */
export function openIdFrom(params: Pick<URLSearchParams, "get">): string | null {
  const id = params.get(openParam);
  return id !== null && uuid.test(id) ? id : null;
}

/** The size a link sets (`compact`, `normal`, `wide` or `full`), or null when it sets none. */
export function sizeFrom(params: Pick<URLSearchParams, "get">): SubmittalPanelWidth | null {
  const size = params.get(sizeParam);
  return submittalPanelSizes.find((p) => p.key === size)?.width ?? null;
}
