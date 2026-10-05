import { formFields, formSchema, type FormFieldType, type FormSchema } from "./form.ts";
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
  "work_item_ref",
  "attachments",
  "photos",
  "checklist",
] as const satisfies readonly FormFieldType[];

/** Keys the engine itself writes in a Transition's event, or beside it: no Action Form field takes them. */
export const actionFormReservedKeys = ["document_number", "outcome", "internal_note"] as const;

/**
 * What stops `schema` from being a Transition's Action Form: the Form's publish
 * checks (formSchemaProblems) less the Built-in Fields' (an Action Form has
 * none), then `not_in_action_form` and `reserved_key`. Empty when there is nothing.
 */
export function actionFormProblems(schema: FormSchema, context: PublishContext = {}): SchemaProblem[] {
  const fields = formFields(schema);
  return [
    ...formSchemaProblems(schema, context).filter((p) => !p.code.startsWith("built_in_")),
    ...fields
      .filter((f) => (notInActionForm as readonly string[]).includes(f.type))
      .map((f): SchemaProblem => ({ key: f.key, code: "not_in_action_form" })),
    ...[...schema.sections, ...fields]
      .filter((item) => (actionFormReservedKeys as readonly string[]).includes(item.key))
      .map((item): SchemaProblem => ({ key: item.key, code: "reserved_key" })),
  ];
}

/** A Transition of a Workflow Version as published: its key and its Action Form, if it has one. */
export type TransitionActionForm = { key: string; actionForm: unknown };

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
  return transitions.flatMap(({ key: transition, actionForm }): ActionFormProblem[] => {
    if (actionForm === null || actionForm === undefined) return [];
    const parsed = formSchema.safeParse(actionForm);
    if (!parsed.success) {
      return parsed.error.issues.map((i) => ({ transition, key: i.path.join(".") || "(schema)", code: "invalid_schema" }));
    }
    return actionFormProblems(parsed.data, context).map((p) => ({ transition, ...p }));
  });
}

/** A Transition's Action Form schema as stored (null: none), parsed. */
export const parseActionForm = (stored: unknown): FormSchema | null =>
  stored === null || stored === undefined ? null : formSchema.parse(stored);
