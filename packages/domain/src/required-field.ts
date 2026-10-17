import { z } from "zod";
import { bilingualText } from "./company.ts";
import { formKey } from "./form.ts";
import { workItemTypeCode } from "./work-item.ts";

// A link question a Project makes required (RP-82, form-engine.md §2.13): Project
// Settings → Required links. Each of the Project's Work Item Types' link questions,
// in the Form a new item of the Type gets there, with whether the Project makes it
// required, such as the WIR's Approved submittals ("Approved submittals required").
// Every Project Member reads it (V20); Project Admins change it. The API then reads
// the field as required on the Project's items of that Type (requiredByProject).

/** One link question of a Type's Form, and whether its Project makes it required. */
export const requiredLinkField = z.object({
  type: workItemTypeCode,
  typeName: bilingualText,
  key: formKey,
  label: bilingualText,
  /** The Form makes it required by itself (always): the Project setting can't turn it off. */
  requiredByForm: z.boolean(),
  /** The Project makes it required. */
  required: z.boolean(),
});
export type RequiredLinkField = z.infer<typeof requiredLinkField>;

/** Project Settings → Required links: every link question of the Project's Types, the Type's order then the Form's. */
export const projectRequiredFields = z.object({
  /** The viewer is one of the Project's Project Admins, who change it. */
  canEdit: z.boolean(),
  fields: z.array(requiredLinkField),
});
export type ProjectRequiredFields = z.infer<typeof projectRequiredFields>;

/** A Project Admin makes a Type's link question required on the Project, or not. */
export const setRequiredFieldRequest = z.object({ type: workItemTypeCode, key: formKey, required: z.boolean() }).strict();
export type SetRequiredFieldRequest = z.infer<typeof setRequiredFieldRequest>;
