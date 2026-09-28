import { z } from "zod";
import { bilingualText } from "./company.ts";

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

/** A Project as one of its Members sees it. */
export const projectSummary = z.object({
  id: z.uuid(),
  /** Within the Host Company's own series: 1, 2, 3… */
  projectNumber: z.number().int().positive(),
  code: z.string(),
  name: bilingualText,
  status: z.enum(["active", "closed"]),
  /** The Project Role the viewer's Company plays on it. */
  projectRole: z.object({ baseRole: z.enum(baseRoles), name: bilingualText }),
  isProjectAdmin: z.boolean(),
});
export type ProjectSummary = z.infer<typeof projectSummary>;

export const myProjects = z.object({ projects: z.array(projectSummary) });
export type MyProjects = z.infer<typeof myProjects>;
