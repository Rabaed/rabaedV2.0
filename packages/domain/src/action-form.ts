import { formFields, formSchema, type FormField, type FormFieldType, type FormSchema } from "./form.ts";
import { formSchemaProblems, type PublishContext, type SchemaProblem } from "./form-publish.ts";

// Action Forms built from Forms (form-engine.md §4, "Settled 2026-10-05 (part 3)";
// workflow-engine.md §1 publish check 7, §5.1; RP-300). Each Transition's
// pop-up is a Form schema on `workflow_transition.action_form`, filled through
// the same validator and renderer as the Form. Its answers go in the Transition
// event's payload. The Internal Note is not one of its fields: it is a fixed
// element under every Action Form, and its own internal event (V5).

/**
 * Field types an Action Form can't hold. Its answers sit in the Transition's
 * event, which everyone who sees a shared event reads: no ids of people,
 * Companies or other items (no stripping function reads it, ADR 0012), no
 * files, and no Built-in Fields, which belong to the item itself.
 */
export const notInActionForm = [
  "trade",
  "location",
  "scopes",
  "member",
  "participant",
  "approved_supplier",
  "checklist_template",
  "work_item_ref",
  "attachments",
  "photos",
  "copied_checklist",
] as const satisfies readonly FormFieldType[];

/**
 * A checklist is taken (Screens, RP-516) while none of its items asks for photos: a
 * photo is a Document, and an Action Form holds no files of a checklist (Inspections, RP-27).
 */
const takesPhotos = (field: FormField): boolean => field.type === "checklist" && field.items.some((i) => i.photo !== "off");

/**
 * The file fields a reply Screen may hold (ADR 0024, RP-623): their files are Documents on
 * the item, added by the Participant holding it before the Transition and taken by it, never
 * part of its event's payload. An Action Form of a Transition's own (no Screen) holds none.
 */
export const screenFileFieldTypes = ["attachments", "photos"] as const satisfies readonly FormFieldType[];

/** Whether `field` is a file field a reply Screen may hold. */
export const isScreenFileField = (field: FormField): boolean => (screenFileFieldTypes as readonly string[]).includes(field.type);

/**
 * The fields a reply Screen holds that the holding Participant fills before the Transition,
 * which takes them, shared (ADR 0024): its file fields, and a checklist bound to the item's
 * copy (RP-86), whose items take photos.
 */
export const isScreenReplyField = (field: FormField): boolean => isScreenFileField(field) || field.type === "copied_checklist";

/** What an Action Form is checked as: `screen` when a Screen gives it, which may hold file fields. */
export type ActionFormOptions = { screen?: boolean };

/** Keys the engine itself writes in a Transition's event, or beside it: no Action Form field takes them. */
export const actionFormReservedKeys = ["document_number", "outcome", "internal_note"] as const;

/**
 * What stops `schema` from being a Transition's Action Form: the Form's publish
 * checks (formSchemaProblems) less the Built-in Fields' (an Action Form has
 * none), then `not_in_action_form` (a Screen's file fields excepted) and `reserved_key`.
 * Empty when there is nothing.
 */
export function actionFormProblems(schema: FormSchema, context: PublishContext = {}, options: ActionFormOptions = {}): SchemaProblem[] {
  const fields = formFields(schema);
  const refused = (f: FormField) =>
    ((notInActionForm as readonly string[]).includes(f.type) && !(options.screen === true && isScreenReplyField(f))) || takesPhotos(f);
  return [
    // `screen_only` is the Form's: an Action Form says `not_in_action_form` below where it applies.
    ...formSchemaProblems(schema, context).filter((p) => !p.code.startsWith("built_in_") && p.code !== "screen_only"),
    ...fields
      .filter(refused)
      .map((f): SchemaProblem => ({ key: f.key, code: "not_in_action_form" })),
    ...[...schema.sections, ...fields]
      .filter((item) => (actionFormReservedKeys as readonly string[]).includes(item.key))
      .map((item): SchemaProblem => ({ key: item.key, code: "reserved_key" })),
  ];
}

/** A Transition of a Workflow Version as published: its key and its Action Form, if it has one (`screen`: a Screen gives it). */
export type TransitionActionForm = { key: string; actionForm: unknown; screen?: boolean };

/** One problem with one Transition's Action Form: `invalid_schema` when it isn't a Form schema at all (`key` is the path). */
export type ActionFormProblem = { transition: string; key: string; code: SchemaProblem["code"] | "invalid_schema" };

/**
 * Publish check 7 (workflow-engine.md §1): every Action Form of a Workflow
 * Version is a valid Form schema. A Transition without one (null) shows only
 * the Internal Note. Problems come Transition by Transition, in the order given.
 */
export function workflowActionFormProblems(
  transitions: readonly TransitionActionForm[],
  context: PublishContext = {},
): ActionFormProblem[] {
  return transitions.flatMap(({ key: transition, actionForm, screen }): ActionFormProblem[] => {
    if (actionForm === null || actionForm === undefined) return [];
    const parsed = formSchema.safeParse(actionForm);
    if (!parsed.success) {
      return parsed.error.issues.map((i) => ({ transition, key: i.path.join(".") || "(schema)", code: "invalid_schema" }));
    }
    return actionFormProblems(parsed.data, context, { screen: screen === true }).map((p) => ({ transition, ...p }));
  });
}

/** A Transition's Action Form schema as stored (null: none), parsed. */
export const parseActionForm = (stored: unknown): FormSchema | null =>
  stored === null || stored === undefined ? null : formSchema.parse(stored);
