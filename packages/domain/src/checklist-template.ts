import { z } from "zod";
import { bilingualText } from "./company.ts";
import { checklistTemplateItem, checklistTemplateItems, formKey, type ChecklistTemplateChoice } from "./form.ts";

// Checklist Templates (RP-651, form-engine.md §3.2): a Project's official sets of
// check items, such as "Concrete pour", each for one of its Trades. Every Project
// Member of every Participant reads them; only Project Admins create, edit (a new
// Version each time) and retire them. A `checklist_template` field picks one, and
// the picked Version's items are copied onto the item, fixed after its first Submit.

/** A template's name in both languages: neither blank, at most 200 characters. */
const templateName = z.object({ en: z.string().trim().min(1).max(200), ar: z.string().trim().min(1).max(200) });

/** A Checklist Template as it reads now: its latest Version. */
export const checklistTemplate = z.object({
  id: z.uuid(),
  /** Its latest Version: what a `checklist_template` field picks. */
  versionId: z.uuid(),
  versionNo: z.number().int().positive(),
  name: bilingualText,
  tradeId: z.uuid(),
  /** A retired one is offered to no new pick; the items that copied it keep their copy. */
  status: z.enum(["active", "retired"]),
  items: z.array(checklistTemplateItem),
});
export type ChecklistTemplate = z.infer<typeof checklistTemplate>;

/** A Project's Checklist Templates, by Trade (as the Trades are listed), then by English name. */
export const checklistTemplates = z.object({
  /** The viewer is one of the Project's Project Admins, who change them. */
  canEdit: z.boolean(),
  templates: z.array(checklistTemplate),
});
export type ChecklistTemplates = z.infer<typeof checklistTemplates>;

/** A Project Admin creates a template, or edits one into its next Version: its names, Trade and items. */
export const checklistTemplateRequest = z.strictObject({ name: templateName, tradeId: z.uuid(), items: checklistTemplateItems });
export type ChecklistTemplateRequest = z.infer<typeof checklistTemplateRequest>;

/**
 * A Checklist Template Version copied onto a Work Item by its `checklist_template`
 * field (`fieldKey`): the definition of the item's checklist, which a later edit
 * or retirement of the template never changes.
 */
export const checklistCopy = z.object({
  fieldKey: formKey,
  templateId: z.uuid(),
  versionId: z.uuid(),
  versionNo: z.number().int().positive(),
  name: bilingualText,
  tradeId: z.uuid(),
  items: z.array(checklistTemplateItem),
});
export type ChecklistCopy = z.infer<typeof checklistCopy>;

/**
 * What a `checklist_template` field may hold, as the validator and the renderer
 * read it: each template's latest Version, offered while the template is active,
 * and the Versions `copies` the item already holds, which stay theirs.
 */
export function checklistTemplateChoices(templates: readonly ChecklistTemplate[], copies: readonly ChecklistCopy[] = []): ChecklistTemplateChoice[] {
  const choices: ChecklistTemplateChoice[] = templates.map((t) => ({
    id: t.versionId,
    tradeId: t.tradeId,
    offered: t.status === "active",
    name: t.name,
    items: t.items,
  }));
  for (const copy of copies) {
    if (!choices.some((c) => c.id === copy.versionId)) {
      choices.push({ id: copy.versionId, tradeId: copy.tradeId, offered: false, name: copy.name, items: copy.items });
    }
  }
  return choices;
}
