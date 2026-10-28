import type { FormSchema, ReplyChecklistRead } from "@rabaed/domain";

/**
 * The Form as the item page shows it beside the reply checklists the viewer answers (RP-1071):
 * without the `checklist_template` fields whose checklist those answer (`copyOf`), and without a
 * section that leaves empty, so the checklist shows once. Everyone else gets no reply checklists
 * (V19) and reads the Form's read-only template, unchanged.
 */
export function formBesideReplyChecklists(schema: FormSchema, checklists: readonly Pick<ReplyChecklistRead, "copyOf">[]): FormSchema {
  const answered = new Set(checklists.map((c) => c.copyOf));
  if (answered.size === 0) return schema;
  const sections = schema.sections
    .map((section) => ({ ...section, fields: section.fields.filter((f) => !(f.type === "checklist_template" && answered.has(f.key))) }))
    .filter((section, i) => section.fields.length > 0 || schema.sections[i]!.fields.length === 0);
  return { ...schema, sections };
}
