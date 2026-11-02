import { submittalPanelSizes, type SubmittalPanelWidth } from "@rabaed/ui";

type SubmittalPanelSizeKey = (typeof submittalPanelSizes)[number]["key"];

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
  } else {
    // An item and the create panel never share the URL (RP-1152).
    params.delete(newParam);
    params.set(openParam, id);
  }
  return withQuery(pathname, params);
}

const withQuery = (pathname: string, params: URLSearchParams) => {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
};

/**
 * The create panel's place in the URL (RP-1152): `?new=1` on the List and the Kanban, `?new=SAR`
 * once a Type is picked (`type` is the List's own Type filter), and the link's size (`&size=wide`
 * from "Add Submittal", `normal` from a direct link). Like `?open=`, a reload or a shared link
 * reopens it, and the size is the link's.
 */
const newParam = "new";
/** A Type code is a short Document Number segment. */
const typeCode = /^[A-Z0-9]{1,10}$/;

/** The page's URL with the create panel open (its Type and size changed where given), or closed (null). Opening it closes an open item. */
export function newSubmittalPanelHref(pathname: string, search: string, open: { type?: string; size?: SubmittalPanelSizeKey } | null): string {
  const params = new URLSearchParams(search);
  if (open === null) {
    params.delete(newParam);
    params.delete(sizeParam);
    return withQuery(pathname, params);
  }
  if (params.has(openParam)) {
    params.delete(openParam);
    params.delete(sizeParam);
  }
  params.set(newParam, open.type ?? params.get(newParam) ?? "1");
  if (open.size !== undefined) params.set(sizeParam, open.size);
  return withQuery(pathname, params);
}

/** Whether the URL opens the create panel, and the Type it names (null when none, or not a Type code). */
export function newItemFrom(params: Pick<URLSearchParams, "get">): { type: string | null } | null {
  const value = params.get(newParam);
  if (value === null || value === "") return null;
  return { type: value !== "1" && typeCode.test(value) ? value : null };
}

/** Where a direct link to the Submittals' New page lands: the List with the create panel at Normal (decision 1). */
export function newItemLanding(projectId: string, type?: string): string {
  return newSubmittalPanelHref(`/projects/${projectId}/work-items`, "", { size: "normal", ...(type !== undefined && typeCode.test(type) ? { type } : {}) });
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
