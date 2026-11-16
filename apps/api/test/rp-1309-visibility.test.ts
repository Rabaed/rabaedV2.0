// Seam 1 for RP-1309 (owner's decision 2026-11-14, after RP-1299; visibility.md V15, V18, V20;
// scenarios RP-1309-1 to RP-1309-5): the Workflow reads with no Project in their path
// (`GET /v1/workflows/:w`, `/map` and `/versions/:n`) follow RP-1299's rule. A Member reads a
// Rabaed Default or a Project's Workflow only when Settings lists it to them on a Project they
// are on: in use there (the one a Type runs, an exception's for whoever reads that exception),
// or, for a Project Admin, every Rabaed Default of its Types and its copies. Anyone else gets the
// plain 404 of a made-up id. A Company's Library Workflow is read by its own Members, as before.
// The seam suites' global setup runs the demo seed, which publishes the eight submittal Defaults.
import { expectHiddenFrom } from "@rabaed/db/test-support";
import type { WorkflowMapRead, WorkflowSettings, WorkflowSettingsType } from "@rabaed/domain";
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

/** The three reads, each answering [{ id }] of the Workflow when the caller reads it, [] for the plain 404. */
const reads = {
  workflow: (id: string) => async (by: Caller) => (await readById<{ id: string }>(`/v1/workflows/${id}`)(by)).map((w) => ({ id: w.id })),
  map: (id: string) => async (by: Caller) => (await readById<WorkflowMapRead>(`/v1/workflows/${id}/map`)(by)).map((m) => ({ id: m.workflow.id })),
  version: (id: string) => async (by: Caller) => (await readById<unknown>(`/v1/workflows/${id}/versions/1`)(by)).map(() => ({ id })),
};
const everyRead = async (target: string, seenBy: Caller | Caller[], hiddenFrom: Caller | Caller[], label: string) => {
  for (const [route, read] of Object.entries(reads)) await expectHiddenFrom({ read: read(target), target, seenBy, hiddenFrom, name: who, label: `${label} (${route})` });
};

const callers = new Map<Caller, string>();
const who = (by: Caller) => callers.get(by) ?? "a caller";

let c1: Company;
let c2: Company;
let otherAdmin: Company;
let at: Tower;
let other: Tower;
let c2Engineer: Caller;
let onNoProject: Caller;
let c2ParticipantId = "";
let marTypeId = "";
/** The Rabaed Default MAR runs on both Towers, and one of the other seven, in use on neither. */
let running = "";
let unused = "";

beforeAll(async () => {
  c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  c2 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "RIU");
  otherAdmin = await api.projectCreator();
  other = await buildTower(api, { c1: otherAdmin, k1: await api.authorizedPerson() }, "RIO");
  c2ParticipantId = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: all, location: all }));
  c2Engineer = await projectMember(api, c2, c2ParticipantId, ["engineer"]);
  onNoProject = (await api.authorizedPerson()).caller;
  callers
    .set(c1.caller, "C1's Project Admin")
    .set(at.c1Engineer, "C1's engineer")
    .set(at.c1Pm, "C1's PM")
    .set(at.k1Manager, "K1's manager")
    .set(c2Engineer, "C2's engineer")
    .set(other.c1Engineer, "another Project's engineer")
    .set(onNoProject, "a Member on no Project")
    .set(otherAdmin.caller, "the second Tower's Project Admin");

  const mar = marOf(await settings(c1.caller, at.projectId));
  marTypeId = mar.id;
  running = mar.workflow.id;
  unused = mar.rabaedDefaults.find((d) => d.id !== running)!.id;
});

describe("scenario RP-1309-1: a Rabaed Default not in use is the plain 404 to a Member who is not a Project Admin", () => {
  it("answers every Member who is not a Project Admin of a Project the 404 of a made-up id, on all three reads", async () => {
    await everyRead(unused, c1.caller, [at.c1Engineer, at.c1Pm, at.k1Manager, c2Engineer, other.c1Engineer, onNoProject], "a Rabaed Default in use nowhere");
    const madeUp = crypto.randomUUID();
    for (const path of [`/v1/workflows/${madeUp}`, `/v1/workflows/${madeUp}/map`, `/v1/workflows/${madeUp}/versions/1`]) await expectHidden(c1.caller.get(path), path); // not hidden-from: a made-up id, the answer the hidden reads above must match
  });
});

describe("scenario RP-1309-2: the Workflow a Type runs is read by every Member of a Project that runs it", () => {
  it("reads it to the Members of both Towers, and not to a Member on no Project", async () => {
    await everyRead(running, [c1.caller, at.c1Engineer, at.c1Pm, at.k1Manager, c2Engineer, other.c1Engineer], onNoProject, "the Rabaed Default MAR runs");
  });
});

describe("scenario RP-1309-3: a Project Admin keeps every Workflow the Project may bind", () => {
  it("reads every Rabaed Default of MAR on all three reads, as the Project's Settings lists them", async () => {
    for (const d of marOf(await settings(c1.caller, at.projectId)).rabaedDefaults) {
      for (const read of Object.values(reads)) expect(await read(d.id)(c1.caller), d.id).toEqual([{ id: d.id }]);
    }
  });

  it("reads a copy no Type runs to the Project Admin only, and to every Member of the Project once MAR runs it", async () => {
    const name = { en: "Tower MARs, short route", ar: "Tower MARs, short route" };
    const copy = (await ok(c1.caller.post(`/v1/workflows/${running}/duplicate`, { projectId: at.projectId, name }), 201)).json().id as string;
    await ok(c1.caller.post(`/v1/workflows/${copy}/publish`), 200);
    await everyRead(copy, c1.caller, [at.c1Engineer, at.k1Manager, c2Engineer, other.c1Engineer], "a published copy no Type runs");

    await ok(c1.caller.request("PUT", `/v1/projects/${at.projectId}/workflow-bindings`, { workItemTypeId: marTypeId, raisingParticipantId: null, workflowId: copy }));
    try {
      await everyRead(copy, [c1.caller, at.c1Engineer, at.k1Manager, c2Engineer], [other.c1Engineer, onNoProject], "the copy MAR runs");
    } finally {
      await ok(c1.caller.request("DELETE", `/v1/projects/${at.projectId}/workflow-bindings?workItemTypeId=${marTypeId}`));
    }
  });
});

describe("scenario RP-1309-4: an exception's Workflow is read by its Participant's Members and the Project Admins only (V15)", () => {
  it("reads it to C2 while the exception lasts, never to C1's other Members or K1, and to nobody but the Project Admin once it is gone", async () => {
    await ok(c1.caller.request("PUT", `/v1/projects/${at.projectId}/workflow-bindings`, { workItemTypeId: marTypeId, raisingParticipantId: c2ParticipantId, workflowId: unused }));
    try {
      await everyRead(unused, [c1.caller, c2Engineer], [at.c1Engineer, at.c1Pm, at.k1Manager, other.c1Engineer, onNoProject], "C2's exception's Workflow");
    } finally {
      await ok(c1.caller.request("DELETE", `/v1/projects/${at.projectId}/workflow-bindings?workItemTypeId=${marTypeId}&raisingParticipantId=${c2ParticipantId}`));
    }
    await everyRead(unused, c1.caller, c2Engineer, "the Workflow once the exception is gone");
  });
});

describe("scenario RP-1309-6: a Project Admin of one Project who is only a Member of another", () => {
  it("reads the unused copies of the Project they administer, and gets the 404 for the other Project's", async () => {
    const name = (en: string) => ({ en, ar: en });
    const publishedCopy = async (admin: Caller, projectId: string, en: string) => {
      const id = (await ok(admin.post(`/v1/workflows/${running}/duplicate`, { projectId, name: name(en) }), 201)).json().id as string;
      await ok(admin.post(`/v1/workflows/${id}/publish`), 200);
      return id;
    };
    // C1 joins the second Tower, and C1's Project Admin of the Tower is a Project Member there, not its Project Admin.
    const c1There = await api.addParticipant(otherAdmin.caller, other.projectId, c1.company, "contractor");
    await api.addProjectMember(c1.caller, c1There, c1.company.authorizedPerson.id);
    expect((await settings(c1.caller, other.projectId)).canEdit).toBe(false);

    const ownUnused = await publishedCopy(c1.caller, at.projectId, "Tower MARs, unused");
    const theirUnused = await publishedCopy(otherAdmin.caller, other.projectId, "Second Tower MARs, unused");
    await everyRead(ownUnused, c1.caller, [at.c1Engineer, otherAdmin.caller], "an unused copy of the Project they administer");
    await everyRead(theirUnused, otherAdmin.caller, [c1.caller, other.c1Engineer], "an unused copy of the Project they are only a Member of");
  });
});

describe("scenario RP-1309-5:a Library Workflow is read by its own Company's Members, as before (V18)", () => {
  it("reads C2's Library copy to C2's Members, on no Project's account, and to no other Company", async () => {
    const name = { en: "C2 MARs", ar: "C2 MARs" };
    const saved = (await ok(c2.caller.post(`/v1/workflows/${running}/save-to-library`, { name }), 201)).json().id as string;
    await everyRead(saved, [c2.caller, c2Engineer], [c1.caller, at.c1Engineer, at.k1Manager, onNoProject], "C2's Library Workflow");
  });
});
