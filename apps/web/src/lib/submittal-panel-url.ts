import { moduleKeySchema, moduleTabPaths, type ModuleKey } from "@rabaed/domain";
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
    params.delete(draftParam);
    params.delete(newModuleParam);
    params.set(openParam, id);
  }
  return withQuery(pathname, params);
}

/**
 * Where a Submittal's own link (`/work-items/<id>`) lands (RP-1237 row 1): its Project's Submittals
 * List with the item open in the panel at Full. Full is the item's page; one view everywhere.
 */
export function itemLanding(projectId: string, id: string): string {
  return withQuery(`/projects/${projectId}/work-items`, new URLSearchParams({ [openParam]: id, [sizeParam]: "full" }));
}

/** The page's URL without the link's size: the viewer picked their own (RP-1237 row 1), so it is theirs now. */
export function withoutLinkSize(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete(sizeParam);
  return withQuery(pathname, params);
}

const withQuery = (pathname: string, params: URLSearchParams) => {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
};

/**
 * The create panel's place in the URL (RP-1152): `?new=1` on the List and the Kanban, `?new=SAR`
 * once a Type is picked (`type` is the List's own Type filter), and the link's size (`&size=wide`
 * from "Add Submittal", `normal` from a direct link). After the first save, `&draft=<id>` holds the
 * new Draft (row 38). Like `?open=`, a reload or a shared link reopens it, and the size is the link's.
 */
const newParam = "new";
const draftParam = "draft";
/** The Module of the create panel, on a tab that shows another Module's items too (RP-1221: the Inspections on the Submittals tab, ADR 0025). */
const newModuleParam = "newModule";
/** A Type code is a short Document Number segment. */
const typeCode = /^[A-Z0-9]{1,10}$/;
export const isTypeCode = (value: string): boolean => typeCode.test(value);
/** The Location the panel opens with (RP-1222 row 23, a Floor plan's way in): `&location=<id>`. */
const locationParam = "location";

/** The Location given on opening: only an id a Location can have, so an edited link fills nothing. */
export function givenLocation(params: Pick<URLSearchParams, "get">): string | null {
  const id = params.get(locationParam);
  return id !== null && uuid.test(id) ? id : null;
}

/** The page's URL with the create panel open (its Type and size changed where given), or closed (null). Opening it closes an open item. */
export function newSubmittalPanelHref(
  pathname: string,
  search: string,
  /** `module` (RP-1221): another Module's panel on this tab, or null for the tab's own; left out, the URL's stays. */
  open: { type?: string; size?: SubmittalPanelSizeKey; draft?: string; module?: ModuleKey | null } | null,
): string {
  const params = new URLSearchParams(search);
  if (open === null) {
    params.delete(newParam);
    params.delete(sizeParam);
    params.delete(draftParam);
    params.delete(newModuleParam);
    params.delete(locationParam);
    return withQuery(pathname, params);
  }
  if (params.has(openParam)) {
    params.delete(openParam);
    params.delete(sizeParam);
  }
  // Another Module's panel starts afresh: its first Type, no Draft of the other's.
  const switching = open.module !== undefined && open.module !== params.get(newModuleParam);
  if (switching) params.delete(draftParam);
  params.set(newParam, open.type ?? (switching ? null : params.get(newParam)) ?? "1");
  if (open.size !== undefined) params.set(sizeParam, open.size);
  if (open.draft !== undefined) params.set(draftParam, open.draft);
  if (open.module === null) params.delete(newModuleParam);
  else if (open.module !== undefined) params.set(newModuleParam, open.module);
  return withQuery(pathname, params);
}

/**
 * Whether the URL opens the create panel, the Type it names (null when none, or not a Type code),
 * and the Draft saved in it (null before the first save, or when not an id an item can have).
 */
export function newItemFrom(params: Pick<URLSearchParams, "get">): { type: string | null; draft: string | null } | null {
  const value = params.get(newParam);
  if (value === null || value === "") return null;
  const draft = params.get(draftParam);
  return { type: value !== "1" && typeCode.test(value) ? value : null, draft: draft !== null && uuid.test(draft) ? draft : null };
}

/** A direct link's Type, when it is a Type code: anything else opens the panel on the first Type. */
const linkType = (type: string | undefined) => (type !== undefined && typeCode.test(type) ? { type } : {});

/** Where a direct link to the Submittals' New page lands: the List with the create panel at Normal (decision 1). */
export function newItemLanding(projectId: string, type?: string): string {
  return newSubmittalPanelHref(`/projects/${projectId}/work-items`, "", { size: "normal", ...linkType(type) });
}

/** The Module the URL's create panel names (RP-1221), with the panel open only: null when it names none, or not a Module's key. */
export function newItemModuleFrom(params: Pick<URLSearchParams, "get">): ModuleKey | null {
  if (newItemFrom(params) === null) return null;
  return moduleKeySchema.safeParse(params.get(newModuleParam)).data ?? null;
}

/**
 * Where a direct link to the New Inspection lands (RP-1221, gap rows 2 and 5): the tab the Project
 * shows Inspections in, with the create panel at Normal. The Inspections tab names the Module; the
 * Submittals tab, when the Project shows them there (ADR 0025), names it in the URL.
 */
export function newInspectionLanding(projectId: string, { inSubmittals }: { inSubmittals: boolean }, type?: string): string {
  const tab = inSubmittals ? moduleTabPaths.submittals : moduleTabPaths.inspections;
  return newSubmittalPanelHref(`/projects/${projectId}/${tab}`, "", {
    size: "normal",
    ...linkType(type),
    ...(inSubmittals ? { module: "inspections" as const } : {}),
  });
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
