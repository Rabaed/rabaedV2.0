import { z } from "zod";
import type { BilingualText } from "./company.ts";

// Company defaults (RP-517, spec RP-511 decision 8; ADR 0019; GLOSSARY "Company default"):
// the Library Form, Workflow or Screen a Company starts a new Project from for a Work Item
// Type. The Authorized Person marks and clears them; every Member of the Company reads them.

/** What a default can be: one per Work Item Type and kind. */
export const companyDefaultKinds = ["form", "workflow", "screen"] as const;
export const companyDefaultKind = z.enum(companyDefaultKinds);
export type CompanyDefaultKind = z.infer<typeof companyDefaultKind>;

/** Mark a Library item of `kind` as the Company's default for a Work Item Type. */
export const setCompanyDefaultRequest = z.object({
  kind: companyDefaultKind,
  workItemTypeId: z.uuid(),
  itemId: z.uuid(),
});
export type SetCompanyDefaultRequest = z.infer<typeof setCompanyDefaultRequest>;

/** Take a default away: new Projects start from the Rabaed Default for that Type again. */
export const clearCompanyDefaultQuery = z.object({ kind: companyDefaultKind, workItemTypeId: z.uuid() });
export type ClearCompanyDefaultQuery = z.infer<typeof clearCompanyDefaultQuery>;

/** The Company's defaults, as its Members read them. */
export type CompanyDefaults = {
  defaults: {
    kind: CompanyDefaultKind;
    workItemTypeId: string;
    workItemTypeCode: string;
    itemId: string;
    name: BilingualText;
  }[];
};
