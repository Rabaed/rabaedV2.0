import { z } from "zod";
import { bilingualText } from "./company.ts";
import { moduleKeySchema, type ModuleKey } from "./module.ts";

/** The four Project Roles every Project starts with; custom roles are based on one of them. */
export const baseRoles = ["contractor", "consultant", "owner", "owner_representative"] as const;
export type BaseRole = (typeof baseRoles)[number];

/** A Project's short code, used in Document Numbers: 2–10 capital letters or digits. */
export const projectCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,10}$/, "Project code must be 2 to 10 letters or digits");

/** A Project Creator creates a Project; their Company joins it in `role`. */
export const createProjectRequest = z.object({
  name: bilingualText,
  code: projectCode,
  role: z.enum(baseRoles),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequest>;

export const createdProject = z.object({ projectId: z.uuid(), projectNumber: z.number().int().positive() });

/** Rabaed's Modules (`moduleKeys`), in the order of the Project's tabs. */
export const moduleTabOrder = ["submittals", "inspections", "snag_list", "site_reports", "drawings"] as const satisfies readonly ModuleKey[];

/**
 * Each Module tab's path under its Project, `/projects/{id}/{path}`: the one
 * place a Module key and its URL meet. Submittals came first, at `work-items`.
 */
export const moduleTabPaths = {
  submittals: "work-items",
  inspections: "inspections",
  snag_list: "snag-list",
  site_reports: "site-reports",
  drawings: "drawings",
} as const satisfies Record<ModuleKey, string>;

/** The Module whose tab is at `path` under its Project, or null. */
export function moduleOfTabPath(path: string): ModuleKey | null {
  return moduleTabOrder.find((m) => moduleTabPaths[m] === path) ?? null;
}

/** A Project as one of its Members sees it. */
export const projectSummary = z.object({
  id: z.uuid(),
  /** Within the Host Company's own series: 1, 2, 3… */
  projectNumber: z.number().int().positive(),
  code: z.string(),
  name: bilingualText,
  status: z.enum(["active", "closed"]),
  /** The Company that created the Project: its name, which every Member of the Project sees (V15). */
  hostCompany: z.object({ legalName: bilingualText }),
  /** The Project Role the viewer's Company plays on it. */
  projectRole: z.object({ baseRole: z.enum(baseRoles), name: bilingualText }),
  isProjectAdmin: z.boolean(),
  /**
   * How many items need the viewer's action: the Steps they hold and the
   * not picked up Steps of their Step Pool, on items they can see; never their own
   * Drafts. 0 on a closed Project.
   */
  needMyAction: z.number().int().nonnegative(),
  /** The Modules the Project has a Work Item Type in, in tab order: each gets a tab, unless `showInspectionsInSubmittals` hides Inspections'. */
  modules: z.array(moduleKeySchema),
  /**
   * The Project setting "Show Inspections in the Submittals tab" (RP-652): the Inspections tab is hidden and the
   * Submittals tab also lists the Inspections Module's items. Inspections stays its own Module either way.
   */
  showInspectionsInSubmittals: z.boolean(),
});
export type ProjectSummary = z.infer<typeof projectSummary>;

export const myProjects = z.object({
  projects: z.array(projectSummary),
  /** Each Project's Submittals the Member sees: the count of their Submittals List there (open and closed), by Project id. */
  submittals: z.record(z.uuid(), z.number().int().nonnegative()),
});
export type MyProjects = z.infer<typeof myProjects>;

/**
 * The Modules that get a tab on the Project (RP-346): the Modules it has a Work Item Type in, but not Inspections
 * while the Project shows it in the Submittals tab (RP-652).
 */
export const projectTabModules = (project: Pick<ProjectSummary, "modules" | "showInspectionsInSubmittals">): ModuleKey[] =>
  project.showInspectionsInSubmittals ? project.modules.filter((m) => m !== "inspections") : project.modules;

/** A Project Admin turns "Show Inspections in the Submittals tab" on or off (RP-652). */
export const showInspectionsInSubmittalsRequest = z.object({ show: z.boolean() });
export type ShowInspectionsInSubmittalsRequest = z.infer<typeof showInspectionsInSubmittalsRequest>;

/** What app.set_show_inspections_in_submittals refuses with: a Member who is no Project Admin of it is told `not_found`. */
export const projectSettingRefusals = ["not_found", "project_closed"] as const;
