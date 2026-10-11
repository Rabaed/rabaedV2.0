import type { BilingualText, StageCopyProblem } from "@rabaed/domain";
import { createdId, setupCall } from "./setup-call";

export type CopyIntoProjectResult = { ok: true; id: string } | { ok: false; error: string; problems: StageCopyProblem[] };

/**
 * A Workflow copied into Project `projectId` as a draft of its own, named `name`
 * (`POST /v1/workflows/:id/duplicate`; WF-4, ADR 0016). The one path of the Library's "Use on
 * a Project", Settings → Workflows' "Use a Library Workflow" and "Duplicate and edit"
 * (decided 2026-10-11): the copy is never published or bound here; a Project Admin reviews
 * it in the builder, then publishes and binds it. A Project lacking a Stage it uses refuses
 * it (`stage_missing`), naming each in `problems`.
 */
export async function copyIntoProject(workflowId: string, projectId: string, name: BilingualText): Promise<CopyIntoProjectResult> {
  const res = await setupCall("POST", `/workflows/${encodeURIComponent(workflowId)}/duplicate`, { projectId, name });
  const id = createdId(res);
  if (id) return { ok: true, id };
  if (res.ok) return { ok: false, error: "unavailable", problems: [] };
  const body = res.body as { problems?: StageCopyProblem[] } | null;
  return { ok: false, error: res.error, problems: res.error === "stage_missing" ? (body?.problems ?? []) : [] };
}
