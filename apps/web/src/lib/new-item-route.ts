import { moduleKeySchema, moduleTabPaths, type ModuleKey } from "@rabaed/domain";
import { projectTabKeys, type ProjectTabKey } from "@rabaed/ui";

// Where a Module's items are raised (RP-1179). Every Module's New page is `/work-items/new`;
// a Module other than the Submittals is named in `?module=`, so the page offers its Types and
// heads itself with its words (a WIR: "Inspections › New WIR", never "New Submittal").

/** The New page for `module`'s items, with the Type `type` picked when given. */
export function newItemHref(projectId: string, module: ModuleKey, type?: string): string {
  const query = new URLSearchParams();
  if (module !== "submittals") query.set("module", module);
  if (type !== undefined) query.set("type", type);
  const search = query.toString();
  return `/projects/${projectId}/work-items/new${search ? `?${search}` : ""}`;
}

/** Where each Project tab leads: a Module's tab at its Module's path (`moduleTabPaths`). */
export function projectTabHref(projectId: string, key: ProjectTabKey): string {
  const base = `/projects/${projectId}`;
  if (key === "dashboard") return base;
  if (key === "settings") return `${base}/settings`;
  if (key === "activity") return `${base}/activity`;
  return `${base}/${moduleTabPaths[key]}`;
}

/**
 * The Project tab `pathname` belongs to: the tab whose page it is under, except the New page,
 * which belongs to the Module its `?module=` names (`moduleParam`), so New WIR is under Inspections.
 * A Module without a tab of its own (`modules`, the Modules with tabs: Inspections shown in the
 * Submittals tab, RP-652) raises under Submittals.
 */
export function projectTabOf(projectId: string, pathname: string, moduleParam: string | null, modules?: readonly ModuleKey[]): ProjectTabKey | undefined {
  const raisesIn = moduleKeySchema.safeParse(moduleParam).data;
  if (raisesIn && pathname === newItemHref(projectId, "submittals")) return !modules || modules.includes(raisesIn) ? raisesIn : "submittals";
  return [...projectTabKeys]
    .reverse()
    .find((key) => (key === "dashboard" ? pathname === projectTabHref(projectId, key) : pathname.startsWith(projectTabHref(projectId, key))));
}
