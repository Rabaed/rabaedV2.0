// Seam 1 for Form answers after Draft (RP-268, spec RP-261; form-engine.md §4;
// visibility.md V5, V13; workflow-engine.md §5.1): the raiser's Participant edits
// the answers in Draft and its internal Steps, every change after Draft is a
// field-level diff in the raiser's own history, and from Submit onwards nobody
// can save. The Consultant and the Owner Representative never see the diffs.
import type { WorkItemHistory } from "@rabaed/domain";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, type Caller, type OnboardedCompany } from "./support/harness.ts";
import { detail, projectMember, tryTake } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

type Company = { company: OnboardedCompany; caller: Caller };
type Role = "contractor" | "consultant" | "owner_representative";

const bilingual = (text: string) => ({ en: text, ar: text });
const all = { isAll: true, valueIds: [] };

const DRAFTED = "Galvanised, 300 mm";
const DRAFT_MODEL = "CT-300";
const REVIEWED = "Hot-dip galvanised, 300 mm";

let c1: Company; // Contractor: raises the MAR.
let engineer: Caller; // C1 Engineer: raised it.
let pm: Caller; // C1 Project Manager: holds Internal Review and Submits.
let signer: Caller; // Consultant Manager.
let orEngineer: Caller; // Owner Representative, covering the whole Project (oversight).
let projectId = "";
let electrical = "";
let buildingA = "";

async function ok(res: Promise<LightMyRequestResponse>, status = 204) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
  return r;
}

async function otherParticipant(role: Role, positions: string[]) {
  const company = await api.authorizedPerson();
  const participantId = await api.addParticipant(c1.caller, projectId, company.company, role);
  await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
  return projectMember(api, company, participantId, positions);
}

/** Save draft: the whole set of answers, the Built-in Fields always among them. */
const save = (by: Caller, id: string, answers: Record<string, unknown>) =>
  by.request("PUT", `/v1/work-items/${id}/answers`, { answers: { trade: electrical, location: buildingA, ...answers } });

async function history(by: Caller, id: string): Promise<WorkItemHistory["events"]> {
  return (await ok(by.get(`/v1/work-items/${id}/history`), 200)).json().events;
}
const diffs = async (by: Caller, id: string) => (await history(by, id)).filter((e) => e.type === "answers_changed");

beforeAll(async () => {
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  electrical = (await c1.caller.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") })).json().id;
  buildingA = (await c1.caller.post(`/v1/projects/${projectId}/locations`, { code: "BA", name: bilingual("Building A"), parentId: null }))
    .json().id;
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  engineer = await projectMember(api, c1, own, ["engineer"]);
  pm = await projectMember(api, c1, own, ["project_manager"]);
  signer = await otherParticipant("consultant", ["manager"]);
  orEngineer = await otherParticipant("owner_representative", ["engineer"]);
});

describe("answers after Draft", () => {
  let id = "";
  const complete = { manufacturer: "ACME Cables", description: DRAFTED };

  beforeAll(async () => {
    id = (await ok(engineer.post(`/v1/projects/${projectId}/work-items`, {
      type: "MAR",
      title: "Cable trays",
      answers: { trade: electrical, location: buildingA, ...complete },
    }), 201)).json().id;
    // Changes in Draft are the Draft itself: no diff.
    await ok(save(engineer, id, { ...complete, model: DRAFT_MODEL }));
    await attachDatasheet(engineer, id);
    await ok(tryTake(engineer, id, "send_for_review"));
    await ok(pm.post(`/v1/work-items/${id}/pick-up`));
  });

  it("records nothing for the saves made in Draft", async () => {
    expect(await diffs(engineer, id)).toEqual([]);
  });

  it("lets the raiser's PM edit them during Internal Review", async () => {
    expect((await detail(pm, id)).actions.saveAnswers).toBe(true);
    await ok(save(pm, id, { ...complete, description: REVIEWED }));
    expect((await detail(pm, id)).answers).toEqual({ ...complete, description: REVIEWED, trade: electrical, location: buildingA });
  });

  it("records the change as a field-level diff, internal to the raiser, with who and when", async () => {
    for (const who of [pm, engineer]) {
      const events = await diffs(who, id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        audience: "internal",
        by: { memberName: { en: "Test Member" } },
        changes: [
          { field: "description", old: DRAFTED, new: REVIEWED },
          { field: "model", old: DRAFT_MODEL, new: null },
        ],
      });
      expect(Date.parse(events[0]!.at)).not.toBeNaN();
    }
  });

  it("records nothing for a save that changes nothing", async () => {
    await ok(save(pm, id, { ...complete, description: REVIEWED }));
    expect(await diffs(pm, id)).toHaveLength(1);
  });

  it("checks the Form is complete again at Submit", async () => {
    await ok(save(engineer, id, { description: REVIEWED }));
    const res = await tryTake(pm, id, "submit");
    expect({ status: res.statusCode, body: res.json() }).toEqual({
      status: 422,
      body: { error: "form_incomplete", fields: [{ key: "manufacturer", code: "required" }] },
    });
    await ok(save(engineer, id, { ...complete, description: REVIEWED }));
    expect(await diffs(pm, id)).toHaveLength(3);
  });

  describe("from Submit onwards", () => {
    beforeAll(async () => {
      await ok(tryTake(pm, id, "submit"));
    });

    it("refuses every save of the Contractor's sections, the Contractor's and the Consultant's alike, and changes nothing", async () => {
      for (const who of [pm, engineer, signer]) {
        // The Consultant may save, but only its own section (MAR Form Version 4, RP-306).
        expect((await detail(who, id)).actions.saveAnswers).toBe(who === signer);
        const res = await save(who, id, { ...complete, description: "Changed after Submit" });
        expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 409, body: { error: "not_editable" } });
      }
      expect((await detail(signer, id)).answers.description).toBe(REVIEWED);
      expect(await diffs(pm, id)).toHaveLength(3);
    });

    it("keeps the diffs in the raiser's history", async () => {
      expect(await diffs(engineer, id)).toHaveLength(3);
    });

    it("never shows the diffs to the Consultant or the Owner Representative (V5)", async () => {
      for (const who of [signer, orEngineer]) {
        const events = await history(who, id);
        // The signer also reads K1's own event: its only manager holds the review at once (§3.3 rule 4).
        expect(events.map((e) => e.type)).toEqual(who === signer ? ["transition", "assigned"] : ["transition"]);
        // They see the Form as Submitted (V13), never what it said before.
        const body = (await who.get(`/v1/work-items/${id}/history`)).body + (await who.get(`/v1/work-items/${id}`)).body;
        expect(body).toContain(REVIEWED);
        expect(body).not.toContain(DRAFTED);
        expect(body).not.toContain(DRAFT_MODEL);
      }
    });
  });
});
