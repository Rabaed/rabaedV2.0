// A test-only Type on the Workflow ending with the Owner's review (addOwnerReviewWorkflow;
// ADR 0022, RP-593), until the Rabaed Default submittal Workflows carry it (RP-596).
import { publishFormVersion } from "@rabaed/admin/services";
import type { Db } from "@rabaed/db";
import { addOwnerReviewWorkflow } from "@rabaed/db/test-support";
import { sql } from "kysely";
import { expect } from "vitest";

/**
 * Adds Rabaed Type `code` on a new Owner's review Workflow, with its Form published with `schema` (as the migrator).
 * `screens` maps a Transition's key to the Screen it shows (addTestScreen's id).
 */
export async function addOwnerReviewType(migrator: Db, code: string, schema: unknown, { screens }: { screens?: Record<string, string> } = {}): Promise<void> {
  const { id: formId } = await migrator
    .insertInto("form_definition")
    .values({ owner_kind: "rabaed", name: JSON.stringify({ en: "Owner's review (test)", ar: "مراجعة المالك (اختبار)" }) })
    .returning("id")
    .executeTakeFirstOrThrow();
  const workflowId = await addOwnerReviewWorkflow((text) => sql.raw(text).execute(migrator), { screens });
  await migrator
    .insertInto("work_item_type")
    .values({
      owner_kind: "rabaed",
      module_key: "submittals",
      code,
      name: JSON.stringify({ en: "Owner's review", ar: "مراجعة المالك" }),
      workflow_definition_id: workflowId,
      outcome_kind: "review_code",
      form_definition_id: formId,
    })
    .execute();
  expect(await publishFormVersion(migrator, formId, schema)).toMatchObject({ ok: true });
}
