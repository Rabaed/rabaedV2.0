// A test-only Type on the test Workflow with a Send Back (addTestWorkflow;
// ADR 0014), for the Send Back tests (RP-334, RP-309): no Rabaed Default uses one yet.
import { publishFormVersion } from "@rabaed/admin/services";
import type { Db } from "@rabaed/db";
import { addTestWorkflow } from "@rabaed/db/test-support";
import { sql } from "kysely";
import { expect } from "vitest";

/** Adds Rabaed Type `code`, named `name`, on a new test Send Back Workflow, with its Form published with `schema` (as the migrator). */
export async function addSendBackType(migrator: Db, code: string, name: { en: string; ar: string }, schema: unknown,
  options: { withApproveB?: boolean; withCancel?: boolean; recommendCode?: boolean; forward?: boolean; notifications?: Record<string, unknown[]> } = {},
): Promise<void> {
  const { id: formId } = await migrator
    .insertInto("form_definition")
    .values({ owner_kind: "rabaed", name: JSON.stringify({ en: `${name.en} (test)`, ar: name.ar }) })
    .returning("id")
    .executeTakeFirstOrThrow();
  const workflowId = await addTestWorkflow((text) => sql.raw(text).execute(migrator), options);
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
  expect(await publishFormVersion(migrator, formId, schema)).toMatchObject({ ok: true });
}
