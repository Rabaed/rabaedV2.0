import type { FixtureRecord } from "./fixtures.ts";
import { Api, projectIdOf } from "./helpers.ts";

// FX-SB (WF-09): Project copies of the MAR Workflow with a Send Back from the Consultant Engineer Step to
// the Contractor Draft Step. Two copies: "After a Send Back: Comment only" and "Edit the Form". The
// Comment only copy is bound to MAR; bindSendBack("edit_form") switches the Project to the other.

type Step = { key: string; afterSendBack?: string; [k: string]: unknown };
type Transition = { key: string; kind: string; from: string; to: string; [k: string]: unknown };
type Definition = { steps: Step[]; transitions: Transition[]; [k: string]: unknown };
type Builder = { workflow: { publishedVersions: number[]; published: { definition: Definition } | null; draft: { definition: Definition } | null } };
type Copy = { id: string; name: { en: string }; versionNo: number | null; bound: boolean; hasDraft: boolean };

export const variants = [
  { mode: "comment", name: "UAT FX-SB MAR Send Back (Comment only)" },
  { mode: "edit_form", name: "UAT FX-SB MAR Send Back (Edit the Form)" },
] as const;

const MAR_DEFAULT = "01a164b3-8cf8-72a8-9622-f16fa9c926c1";

function must<T>(reply: { status: number; body: unknown; text: string }, what: string): T {
  if (reply.status >= 400) throw new Error(`${what} answered ${reply.status}: ${reply.text.slice(0, 400)}`);
  return reply.body as T;
}

const withSendBack = (definition: Definition, mode: string): Definition => ({
  ...definition,
  steps: definition.steps.map((s) => (s.key === "draft" ? { ...s, afterSendBack: mode } : s)),
  transitions: definition.transitions.some((t) => t.kind === "send_back")
    ? definition.transitions
    : [
        ...definition.transitions,
        {
          key: "send_back_to_draft",
          label: { en: "Send Back", ar: "إعادة للمقاول" },
          kind: "send_back",
          from: "consultant_engineer",
          to: "draft",
          outcome: null,
          permission: "review",
          actionForm: null,
        },
      ],
});

async function settings(api: Api, projectId: string) {
  const ws = must<{ types: { id: string; code: string; workflow: { id: string }; copies: Copy[] }[] }>(await api.get(`/projects/${projectId}/workflow-settings`), "workflow settings");
  const mar = ws.types.find((t) => t.code === "MAR");
  if (!mar) throw new Error("The Project has no MAR Type.");
  return mar;
}

export async function bindSendBack(api: Api, projectId: string, mode: "comment" | "edit_form"): Promise<void> {
  const mar = await settings(api, projectId);
  const copy = mar.copies.find((c) => c.name.en === variants.find((v) => v.mode === mode)!.name);
  if (!copy) throw new Error(`No ${mode} copy: run --fixtures --only FX-SB first.`);
  if (copy.bound) return;
  must(await api.request("PUT", `/projects/${projectId}/workflow-bindings`, { workItemTypeId: mar.id, raisingParticipantId: null, workflowId: copy.id }), "bind");
}

export async function applySendBackWorkflows(): Promise<FixtureRecord> {
  const api = await Api.as("saeed");
  const projectId = await projectIdOf(api);
  if (!projectId) throw new Error("Saeed does not see the Project.");
  const done: string[] = [];
  for (const variant of variants) {
    let mar = await settings(api, projectId);
    let copy = mar.copies.find((c) => c.name.en === variant.name);
    if (!copy) {
      const { id } = must<{ id: string }>(await api.post(`/workflows/${MAR_DEFAULT}/duplicate`, { projectId, name: { en: variant.name, ar: variant.name } }), "duplicate MAR");
      mar = await settings(api, projectId);
      copy = mar.copies.find((c) => c.id === id)!;
      done.push(`copied MAR as "${variant.name}"`);
    }
    const builder = must<Builder>(await api.get(`/workflows/${copy.id}/builder`), "builder");
    const latest = builder.workflow.published?.definition;
    const ready = latest?.transitions.some((t) => t.kind === "send_back") && latest.steps.find((s) => s.key === "draft")?.afterSendBack === variant.mode;
    if (ready && !copy.hasDraft) {
      done.push(`"${variant.name}" already published (v${builder.workflow.publishedVersions.at(-1)})`);
      continue;
    }
    const definition = withSendBack((builder.workflow.draft?.definition ?? latest)!, variant.mode);
    const check = must<{ issues: unknown[]; problems: { code: string; severity: string }[] }>(await api.post(`/workflows/${copy.id}/validate`, { definition }), "validate");
    const errors = check.issues.length + check.problems.filter((p) => p.severity === "error").length;
    if (errors > 0) throw new Error(`"${variant.name}" does not validate: ${JSON.stringify(check).slice(0, 400)} (a Bug for WF-09 if the Send Back is refused).`);
    must(await api.put(`/workflows/${copy.id}/draft`, { definition }), "save draft");
    const published = must<{ versionNo: number }>(await api.post(`/workflows/${copy.id}/publish`, { changeNote: "UAT FX-SB: Send Back to the Draft Step" }), "publish");
    done.push(`published "${variant.name}" as v${published.versionNo}`);
  }
  const mar = await settings(api, projectId);
  if (!mar.copies.some((c) => c.bound)) {
    await bindSendBack(api, projectId, "comment");
    done.push("bound the Comment only copy to MAR");
  } else {
    done.push(`MAR already bound to "${mar.copies.find((c) => c.bound)!.name.en}"`);
  }
  const changed = done.some((d) => !d.includes("already"));
  return { status: changed ? "applied" : "already", detail: `${done.join("; ")}.`, at: new Date().toISOString() };
}
