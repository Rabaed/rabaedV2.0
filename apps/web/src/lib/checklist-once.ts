import type { FormSchema, ReplyChecklistRead } from "@rabaed/domain";

/** The reply checklists the viewer answers on the item page: each names the Checklist Template field it copies. */
export type AnsweredChecklists = readonly Pick<ReplyChecklistRead, "copyOf">[];

/**
 * The Form as the item page shows it beside the reply checklists the viewer answers (RP-1071), so
 * the checklist shows once: without the Checklist Template fields those checklists copy
 * (`copyOf`), and without a section that this leaves empty. Every other reader gets no reply
 * checklists (V19) and reads the Form's read-only Checklist Template field, unchanged.
 */
export function formBesideReplyChecklists(schema: FormSchema, checklists: AnsweredChecklists): FormSchema {
  const answered = new Set(checklists.map((c) => c.copyOf));
  if (answered.size === 0) return schema;
  const copied = (field: FormSchema["sections"][number]["fields"][number]) => field.type === "checklist_template" && answered.has(field.key);
  // A section loses only its copied fields, and goes only when they were all it held.
  const sections = schema.sections.flatMap((section) => {
    const fields = section.fields.filter((f) => !copied(f));
    return fields.length === 0 && section.fields.length > 0 ? [] : [{ ...section, fields }];
  });
  return { ...schema, sections };
}
