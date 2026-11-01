// Seam 1 for scenario RP-1192-1 (visibility.md V14): while K1 holds C1's Submittal at either of K1's own
// Steps (Consultant review, where C1's Submit took it; Consultant approval, after K1's Send to Manager),
// C1 and the Owner Representative read no K1 Step, by key or by name, in the item read (the Work Item page
// and the Submittal Panel), its List row, its Kanban card or its history (the `toStep` of C1's own Submit).
// They read K1 by its Company and its role (the map's position). K1's own Members read the Step, the
// positive control of every expectHiddenFrom. Seam 2: packages/db/test/rp-1192-visibility-rls.test.ts.
import { randomInt } from "node:crypto";
import { sql } from "kysely";
import { createDb } from "@rabaed/db";
import { expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import type { WorkItemDetail, WorkItemWorkflowMap } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { all, bilingual, buildTower, ok, projectMember, take, type Tower } from "./support/tower.ts";

const api = await createTestApi();
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const TYPE = `RX${Array.from({ length: 3 }, () => String.fromCharCode(65 + randomInt(26))).join("")}`;
const schema = {
  sections: [
    { key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] },
    {
      key: "classification",
      title: bilingual("Classification"),
      fields: [
        { key: "trade", type: "trade", label: bilingual("Trade") },
        { key: "location", type: "location", label: bilingual("Location") },
        { key: "scopes", type: "scopes", label: bilingual("Scopes") },
      ],
    },
  ],
};

let at: Tower;
let k1Engineer: Caller;
let orEngineer: Caller;
let atReview = "";
let atApproval = "";
const names = new Map<Caller, string>();
const named = (by: Caller) => names.get(by) ?? "someone";
/** K1's two Steps on the item's Workflow Version, with their names. */
const k1Steps = new Map<string, { en: string; ar: string }>();

/**
 * The K1 Steps `by` reads, by key, from what item `id` shows them: the item read, the Project's List
 * and Kanban (this test's items only) and the item's history. A Step counts when its key is given as a
 * key, or its name in either language appears anywhere in those answers.
 */
const stepsRead = (id: string) => async (by: Caller) => {
  const read = JSON.stringify({
    item: (await ok(by.get(`/v1/work-items/${id}`), 200)).json(),
    list: (await ok(by.get(`/v1/projects/${at.projectId}/work-items`), 200)).json(),
    kanban: (await ok(by.get(`/v1/projects/${at.projectId}/work-items/kanban`), 200)).json(),
    history: (await ok(by.get(`/v1/work-items/${id}/history`), 200)).json(),
  });
  return [...k1Steps].flatMap(([key, name]) => (read.includes(`"${key}"`) || read.includes(name.en) || read.includes(name.ar) ? [{ id: key }] : []));
};

beforeAll(async () => {
  await addSendBackType(migrator, TYPE, bilingual("Step outside (RP-1192)"), schema);
  const c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  const or = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "RXT");
  k1Engineer = await projectMember(api, k1, at.k1ParticipantId!, ["engineer"]);
  const orParticipant = await api.addParticipant(c1.caller, at.projectId, or.company, "owner_representative");
  await ok(c1.caller.request("PUT", `/v1/participants/${orParticipant}/visibility`, { trade: all, location: all }));
  orEngineer = await projectMember(api, or, orParticipant, ["engineer"]);
  for (const [by, name] of [
    [at.c1Engineer, "C1 engineer"],
    [at.c1Pm, "C1 PM"],
    [orEngineer, "OR engineer"],
    [k1Engineer, "K1 engineer"],
    [at.k1Manager, "K1 manager"],
  ] as const)
    names.set(by, name);

  const atConsultant = async (title: string) => {
    const id = (await ok(at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, { type: TYPE, title, answers: { model: "CT-1", trade: at.electrical, location: at.buildingA } }), 201)).json()
      .id as string;
    await take(at.c1Engineer, id, "send_for_review");
    await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await take(at.c1Pm, id, "submit");
    await ok(k1Engineer.post(`/v1/work-items/${id}/pick-up`));
    return id;
  };
  atReview = await atConsultant("Cable tray risers");
  atApproval = await atConsultant("Busbar trunking");
  await take(k1Engineer, atApproval, "send_to_manager");
  await ok(at.k1Manager.post(`/v1/work-items/${atApproval}/pick-up`));

  const { rows } = await sql<{ key: string; name: { en: string; ar: string } }>`
    select s.key, s.name from work_item w join workflow_step s on s.workflow_version_id = w.workflow_version_id
    where w.id = ${atReview}::uuid and s.key in ('consultant_review', 'consultant_approval')`.execute(migrator);
  for (const r of rows) k1Steps.set(r.key, r.name);
  expect([...k1Steps.keys()].sort()).toEqual(["consultant_approval", "consultant_review"]);
});

describe("scenario RP-1192-1: K1 holds C1's Submittal at one of K1's own Steps", () => {
  const outside = () => [at.c1Engineer, at.c1Pm, orEngineer];
  const k1 = () => [k1Engineer, at.k1Manager];

  /** Each item with the K1 Step it is held at: Consultant review (where C1's Submit took it) and Consultant approval (after K1's Send to Manager). */
  const held = () =>
    [
      [atReview, "consultant_review"],
      [atApproval, "consultant_approval"],
    ] as const;

  it("the item read, its List row, its Kanban card and its history name no K1 Step to C1 or the OR, at either K1 Step; K1 reads its own", async () => {
    for (const [item, target] of held()) {
      await expectHiddenFrom({ read: stepsRead(item), target, seenBy: k1(), hiddenFrom: outside(), name: named, label: `K1's ${target}` });
      // Not even the Step C1's Submit reached.
      for (const by of outside()) expect(await stepsRead(item)(by), `${named(by)} at ${target}`).toEqual([]);
    }
  });

  it("C1 and the OR read the item with K1 by its Company and its role, and no Step", async () => {
    for (const [item, target] of held()) {
      for (const by of outside()) {
        const read = (await ok(by.get(`/v1/work-items/${item}`), 200)).json() as WorkItemDetail;
        expect([read.step, read.heldBy?.memberName ?? null], named(by)).toEqual([null, null]);
        expect(read.heldBy?.companyName, named(by)).toBeDefined(); // not hidden-from: K1's Company is "With" for everyone (V14)
        const map = (await ok(by.get(`/v1/work-items/${item}/workflow`), 200)).json() as WorkItemWorkflowMap;
        expect(map.position, named(by)).toEqual({ kind: "company", role: "consultant", companyName: read.heldBy!.companyName });
      }
      for (const by of k1()) {
        const read = (await ok(by.get(`/v1/work-items/${item}`), 200)).json() as WorkItemDetail;
        expect(read.step?.key, named(by)).toBe(target);
        const map = (await ok(by.get(`/v1/work-items/${item}/workflow`), 200)).json() as WorkItemWorkflowMap;
        expect(map.position, named(by)).toEqual({ kind: "own", stepKey: target });
      }
    }
  });
});
