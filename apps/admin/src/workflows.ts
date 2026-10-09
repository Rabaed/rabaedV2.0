import { validateRabaedDefaultWorkflow, writeRabaedDefaultWorkflow, type Db, type RabaedDefaultResult } from "@rabaed/db";
import type { RabaedWorkflowRequest, WorkflowValidation } from "@rabaed/domain";
import { asEngineer } from "./admin-action.ts";
import { Refused, refusable } from "./refusals.ts";

// Rabaed Default Workflows (RP-427, WF-4; workflow-engine.md §1 "Authoring"): Rabaed's own
// data, which Rabaed Engineers author here, a Work Item Type's at a time. Saving a draft
// and publishing are Engineer actions with a reason in admin_action (V9); checking a
// definition reads nothing of a Company's and asks for none. The `workflow:publish` CLI
// publishes the same way (writeRabaedDefaultWorkflow).

/** A definition checked against the Rabaed Default of Type `typeCode`; null for no such Type. */
export function validateRabaedWorkflow(adminDb: Db, typeCode: string, definition: unknown): Promise<WorkflowValidation | null> {
  return validateRabaedDefaultWorkflow(adminDb, typeCode, definition);
}

/** Why a Rabaed Default wasn't saved or published, with the issues or problems found. */
type Refusal = Exclude<RabaedDefaultResult, { ok: true }>;

/**
 * Saves the definition as the draft of Type `typeCode`'s Rabaed Default or, with
 * `publish`, publishes it as its next Version after every publish check. A refusal rolls
 * back and logs nothing.
 */
export async function writeRabaedWorkflow(
  adminDb: Db,
  engineerId: string,
  typeCode: string,
  input: RabaedWorkflowRequest,
  { publish }: { publish: boolean },
): Promise<{ ok: true; versionNo: number } | Refusal> {
  let refusal: Refusal | undefined;
  const result = await refusable(() =>
    asEngineer(adminDb, { engineerId, action: publish ? "publish_workflow" : "save_workflow_draft", reason: input.reason }, async (trx) => {
      const written = await writeRabaedDefaultWorkflow(trx, typeCode, input.definition, { publish });
      if (!written.ok) {
        refusal = written;
        throw new Refused(written.reason);
      }
      return {
        target: { kind: "workflow_definition", id: written.definitionId },
        after: { typeCode, versionNo: written.versionNo, published: publish },
        result: written.versionNo,
      };
    }),
  );
  if (result.ok) return { ok: true, versionNo: result.value };
  return refusal!;
}
