// Seam 1 for RP-1299 (UAT round 0, WF-01; owner's decision 2026-11-13; visibility.md V15, V20;
// scenarios RP-1299-1 to RP-1299-3): on Project → Settings → Workflows, a Member who is not a
// Project Admin is listed only the Workflows in use on the Project (the one each Type runs, and
// an exception's, for whoever reads that exception), while the Project Admin keeps the full list
// with the in-use one marked. A direct link to a Workflow not in use is the plain 404 to a
// non-admin, as a made-up id is; the Screen pins name no such Workflow to them either.
// The seam suites' global setup runs the demo seed, which publishes the eight submittal Defaults.
import { expectHiddenFrom } from "@rabaed/db/test-support";
import type { ScreenPins, WorkflowDefinition, WorkflowSettings, WorkflowSettingsType } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, readById, type Caller } from "./support/harness.ts";
import { all, buildTower, ok, projectMember, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(async () => {
  await api.close();
});

const settings = async (by: Caller, projectId: string): Promise<WorkflowSettings> =>
  (await ok(by.get(`/v1/projects/${projectId}/workflow-settings`), 200)).json();
const marOf = (s: WorkflowSettings): WorkflowSettingsType => s.types.find((t) => t.code === "MAR")!;

const callers = new Map<Caller, string>();
const who = (by: Caller) => callers.get(by) ?? "a caller";

let c1: Company;
let at: Tower;
let other: Tower;
let c2Engineer: Caller;
let c2ParticipantId = "";
/** The Rabaed Default MAR runs on the Tower, and one of the other seven, in use nowhere on it. */
let running = "";
let unused = "";

beforeAll(async () => {
  c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  const c2 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "WIU");
  other = await buildTower(api, { c1: await api.projectCreator(), k1: await api.authorizedPerson() }, "WIO");
  c2ParticipantId = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: all, location: all }));
  c2Engineer = await projectMember(api, c2, c2ParticipantId, ["engineer"]);
  callers.set(c1.caller, "C1's Project Admin").set(at.c1Engineer, "C1's engineer").set(at.c1Pm, "C1's PM").set(at.k1Manager, "K1's manager").set(c2Engineer, "C2's engineer");

  const mar = marOf(await settings(c1.caller, at.projectId));
  running = mar.workflow.id;
  unused = mar.rabaedDefaults.find((d) => d.id !== running)!.id;
});

describe("scenario RP-1299-1: a Member who is not a Project Admin is listed only the Workflows in use", () => {
  it("lists the Project Admin every Rabaed Default of the Type, the one it runs marked in use", async () => {
    const mar = marOf(await settings(c1.caller, at.projectId));
    expect(mar.rabaedDefaults.length).toBeGreaterThan(1);
    expect(mar.rabaedDefaults.filter((d) => d.bound).map((d) => d.id)).toEqual([running]);
  });

  it("lists everyone else only the one the Type runs, in use", async () => {
    for (const reader of [at.c1Engineer, at.c1Pm, at.k1Manager, c2Engineer]) {
      const mar = marOf(await settings(reader, at.projectId));
      expect(mar.workflow.id, who(reader)).toBe(running);
      expect(mar.rabaedDefaults.map((d) => ({ id: d.id, bound: d.bound })), who(reader)).toEqual([{ id: running, bound: true }]);
    }
    const listed = async (by: Caller) => marOf(await settings(by, at.projectId)).rabaedDefaults;
    await expectHiddenFrom({ read: listed, target: unused, seenBy: c1.caller, hiddenFrom: [at.c1Engineer, at.c1Pm, at.k1Manager, c2Engineer], name: who, label: "a Rabaed Default not in use" });
  });
});

describe("scenario RP-1299-2: a direct link to a Workflow's Version on the Project", () => {
  const version = (projectId: string, workflowId: string) => `/v1/projects/${projectId}/workflows/${workflowId}/versions/1`;
  // A Version read answers [{ id }] of the Workflow it belongs to (RP-1126).
  const readOf = (projectId: string, workflowId: string) => async (by: Caller) => (await readById<unknown>(version(projectId, workflowId))(by)).map(() => ({ id: workflowId }));

  it("reads the Workflow a Type runs to every Member of the Project, and to nobody else", async () => {
    await expectHiddenFrom({
      read: readOf(at.projectId, running),
      target: running,
      seenBy: [c1.caller, at.c1Engineer, at.c1Pm, at.k1Manager, c2Engineer],
      hiddenFrom: other.c1Engineer,
      name: who,
      label: "the Workflow MAR runs, on the Tower",
    });
  });

  it("reads one not in use to the Project Admin only: anyone else gets the 404 of a made-up id", async () => {
    await expectHiddenFrom({ read: readOf(at.projectId, unused), target: unused, seenBy: c1.caller, hiddenFrom: [at.c1Engineer, at.c1Pm, at.k1Manager, c2Engineer, other.c1Engineer], name: who, label: "a Rabaed Default not in use" });
    await expectHidden(c1.caller.get(version(at.projectId, "00000000-0000-4000-8000-000000000000"))); // not hidden-from: a made-up id, the answer the hidden reads above must match
    await expectHidden(c1.caller.get(`/v1/projects/${at.projectId}/workflows/${running}/versions/99`)); // not hidden-from: a Version that doesn't exist
  });

  it("reads an exception's Workflow to that Participant's Members and the Project Admins only (V15)", async () => {
    await ok(c1.caller.request("PUT", `/v1/projects/${at.projectId}/workflow-bindings`, { workItemTypeId: marOf(await settings(c1.caller, at.projectId)).id, raisingParticipantId: c2ParticipantId, workflowId: unused }));
    try {
      await expectHiddenFrom({ read: readOf(at.projectId, unused), target: unused, seenBy: [c1.caller, c2Engineer], hiddenFrom: [at.c1Engineer, at.c1Pm, at.k1Manager], name: who, label: "C2's exception's Workflow" });
    } finally {
      await ok(c1.caller.request("DELETE", `/v1/projects/${at.projectId}/workflow-bindings?workItemTypeId=${marOf(await settings(c1.caller, at.projectId)).id}&raisingParticipantId=${c2ParticipantId}`));
    }
    await expectHiddenFrom({ read: readOf(at.projectId, unused), target: unused, seenBy: c1.caller, hiddenFrom: c2Engineer, name: who, label: "the Workflow once the exception is gone" });
  });
});

describe("scenario RP-1299-3: the Screen pins name only the Workflows the reader is listed", () => {
  it("names a published copy no Type runs to the Project Admin only, and to everyone once the Type runs it", async () => {
    const label = (en: string) => ({ en, ar: en });
    const schema = { sections: [{ key: "reply", title: label("Reply"), fields: [{ key: "remarks", type: "textarea", label: label("Remarks") }] }] };
    const screen = (await ok(c1.caller.post(`/v1/projects/${at.projectId}/screens`, { key: "unused_pin", name: label("Unused pin"), schema, internalFields: [] }), 201)).json().id;
    await ok(c1.caller.post(`/v1/screens/${screen}/publish`), 200);
    const copy = (await ok(c1.caller.post(`/v1/workflows/${running}/duplicate`, { projectId: at.projectId, name: label("Tower MARs, pinned") }), 201)).json().id as string;
    const definition: WorkflowDefinition = (await ok(c1.caller.get(`/v1/workflows/${copy}/builder`), 200)).json().workflow.draft.definition;
    const send = definition.transitions.find((t) => t.kind === "send")!.key;
    const pinned = { ...definition, transitions: definition.transitions.map((t) => (t.key === send ? { ...t, actionForm: null, screen: "unused_pin" } : t)) };
    await ok(c1.caller.request("PUT", `/v1/workflows/${copy}/draft`, { definition: pinned }), 200);
    await ok(c1.caller.post(`/v1/workflows/${copy}/publish`), 200);

    const pins = async (by: Caller) => (await readById<ScreenPins>(`/v1/projects/${at.projectId}/screen-pins`)(by)).flatMap((p) => p.pins).map((p) => ({ id: p.workflowId }));
    await expectHiddenFrom({ read: pins, target: copy, seenBy: c1.caller, hiddenFrom: [at.c1Engineer, at.k1Manager, c2Engineer], name: who, label: "the pin of a copy no Type runs" });

    const marTypeId = marOf(await settings(c1.caller, at.projectId)).id;
    await ok(c1.caller.request("PUT", `/v1/projects/${at.projectId}/workflow-bindings`, { workItemTypeId: marTypeId, raisingParticipantId: null, workflowId: copy }));
    try {
      await expectHiddenFrom({ read: pins, target: copy, seenBy: [c1.caller, at.c1Engineer, at.k1Manager, c2Engineer], hiddenFrom: other.c1Engineer, name: who, label: "the pin of the copy MAR runs" });
    } finally {
      await ok(c1.caller.request("DELETE", `/v1/projects/${at.projectId}/workflow-bindings?workItemTypeId=${marTypeId}`));
    }
  });
});
