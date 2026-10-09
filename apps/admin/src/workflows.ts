import { writeRabaedDefaultWorkflow, type Db, type RabaedDefaultResult } from "@rabaed/db";
import type { RabaedWorkflowRequest } from "@rabaed/domain";
import { asEngineer } from "./admin-action.ts";
import { Refused, refusable } from "./refusals.ts";

// Rabaed Default Workflows (RP-427, WF-4; workflow-engine.md §1 "Authoring"): Rabaed's own
// data, which Rabaed Engineers author here, a Work Item Type's at a time. Saving a draft
// and publishing are Engineer actions with a reason in admin_action (V9), from Rabaed
// Admin's routes and from the `workflow:publish` CLI alike; checking a definition
// (validateRabaedDefaultWorkflow) reads nothing of a Company's and asks for none.

/** Why a Rabaed Default wasn't saved or published, with the issues or problems found. */
type Refusal = Exclude<RabaedDefaultResult, { ok: true }>;

/**
 * Rabaed Engineer `engineerId` saves the definition as the draft of Type `typeCode`'s
 * Rabaed Default or, with `publish`, publishes it as its next Version after every
 * publish check, logged in admin_action with the reason. A refusal rolls back and logs
 * nothing.
 */
export async function writeRabaedWorkflow(
  db: Db,
  engineerId: string,
  typeCode: string,
  input: RabaedWorkflowRequest,
  { publish }: { publish: boolean },
): Promise<RabaedDefaultResult> {
  let refusal: Refusal | undefined;
  const result = await refusable(() =>
    asEngineer(db, { engineerId, action: publish ? "publish_workflow" : "save_workflow_draft", reason: input.reason }, async (trx) => {
      const written = await writeRabaedDefaultWorkflow(trx, typeCode, input.definition, { publish });
      if (!written.ok) {
        refusal = written;
        throw new Refused(written.reason);
      }
      return {
        target: { kind: "workflow_definition", id: written.definitionId },
        after: { typeCode, versionNo: written.versionNo, published: publish },
        result: written,
      };
    }),
  );
  if (result.ok) return result.value;
  return refusal!;
}

/**
 * The `workflow:publish` CLI's publish: as `writeRabaedWorkflow`, by the active Rabaed
 * Engineer whose Rabaed Admin email is `engineerEmail`. The CLI signs nobody in: it runs
 * with the migrator's credentials, so the email names who is accountable in
 * admin_action, as `engineer:create` names whom it creates.
 */
export async function publishRabaedWorkflowAs(
  db: Db,
  input: { engineerEmail: string; typeCode: string; definition: unknown; reason: string },
): Promise<RabaedDefaultResult | { ok: false; reason: "engineer_not_found" }> {
  const engineer = await db
    .selectFrom("rabaed_engineer")
    .select("id")
    .where("email", "=", input.engineerEmail.trim().toLowerCase())
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!engineer) return { ok: false, reason: "engineer_not_found" };
  return writeRabaedWorkflow(db, engineer.id, input.typeCode, { definition: input.definition, reason: input.reason }, { publish: true });
}
