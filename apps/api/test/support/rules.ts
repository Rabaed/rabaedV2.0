// A test-only Type on the test Workflow with Restrict and Validate rules
// (addRulesWorkflow; RP-430, WF-7): no Rabaed Default has rules yet.
import { publishFormVersion } from "@rabaed/admin/services";
import type { Db } from "@rabaed/db";
import { addRulesWorkflow, rulesFormSchema } from "@rabaed/db/test-support";
import { sql } from "kysely";
import { expect } from "vitest";

/** Adds Rabaed Type `code` on a new rules Workflow, its Form published with rulesFormSchema (as the migrator). */
export async function addRulesType(migrator: Db, code: string): Promise<void> {
  const { id: formId } = await migrator
    .insertInto("form_definition")
    .values({ owner_kind: "rabaed", name: JSON.stringify({ en: "Rules (test)", ar: "القواعد (اختبار)" }) })
    .returning("id")
    .executeTakeFirstOrThrow();
  const workflowId = await addRulesWorkflow((text) => sql.raw(text).execute(migrator));
  await migrator
    .insertInto("work_item_type")
    .values({
      owner_kind: "rabaed",
      module_key: "submittals",
      code,
      name: JSON.stringify({ en: "Ruled submittal", ar: "تقديم بقواعد" }),
      workflow_definition_id: workflowId,
      outcome_kind: "review_code",
      form_definition_id: formId,
    })
    .execute();
  const published = await publishFormVersion(migrator, formId, rulesFormSchema);
  expect(published, JSON.stringify(published)).toMatchObject({ ok: true });
}
