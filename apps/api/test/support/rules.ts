// Test-only Types on the test Workflows with Restrict and Validate rules
// (addRulesWorkflow; RP-430, WF-7) and with actions (addActionsWorkflow; RP-431,
// WF-8): no Rabaed Default has rules or actions yet.
import { publishFormVersion } from "@rabaed/admin/services";
import type { Db } from "@rabaed/db";
import { actionsFormSchema, addActionsWorkflow, addRulesWorkflow, rulesFormSchema, type RulesTransition } from "@rabaed/db/test-support";
import { sql } from "kysely";
import { expect } from "vitest";

type AddWorkflow = (run: (text: string) => Promise<{ rows: unknown[] }>) => Promise<string>;

/** Adds Rabaed Type `code` named `name` on a new Workflow from `addWorkflow`, its Form published with `schema` (as the migrator). */
async function addTestType(migrator: Db, code: string, name: { en: string; ar: string }, addWorkflow: AddWorkflow, schema: unknown): Promise<void> {
  const { id: formId } = await migrator
    .insertInto("form_definition")
    .values({ owner_kind: "rabaed", name: JSON.stringify(name) })
    .returning("id")
    .executeTakeFirstOrThrow();
  const workflowId = await addWorkflow((text) => sql.raw(text).execute(migrator));
  await migrator
    .insertInto("work_item_type")
    .values({
      owner_kind: "rabaed",
      module_key: "submittals",
      code,
      name: JSON.stringify(name),
      workflow_definition_id: workflowId,
      outcome_kind: "review_code",
      form_definition_id: formId,
    })
    .execute();
  const published = await publishFormVersion(migrator, formId, schema);
  expect(published, JSON.stringify(published)).toMatchObject({ ok: true });
}

/** Adds Rabaed Type `code` on a new rules Workflow (with the `extra` Transitions), its Form published with rulesFormSchema (as the migrator). */
export function addRulesType(migrator: Db, code: string, extra: RulesTransition[] = []): Promise<void> {
  return addTestType(migrator, code, { en: "Ruled submittal", ar: "تقديم بقواعد" }, (run) => addRulesWorkflow(run, { extra }), rulesFormSchema);
}

/** Adds Rabaed Type `code` on a new actions Workflow, its Form published with actionsFormSchema (as the migrator). */
export function addActionsType(migrator: Db, code: string): Promise<void> {
  return addTestType(migrator, code, { en: "Submittal with actions", ar: "تقديم بإجراءات" }, (run) => addActionsWorkflow(run), actionsFormSchema);
}
