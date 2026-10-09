// Seam 1: which Workflow a new item runs (RP-426; ADR 0016; workflow-engine.md
// §1 "Ownership and binding"; visibility.md V20, scenarios RP-426-1 and RP-426-2). A
// Project binds a Work Item Type to one of its own Workflows, optionally only for
// one raising Participant; a new item starts on the latest published Version of
// the raiser's exception, else the Project's binding, else the Type's Rabaed
// Default, and keeps it. The item reads its Workflow's name and Version number.
// The map is everyone's on the Project, but what happens at another Company's
// internal Steps stays its own (V5, V14). Bindings are written by the migrator
// here: their authoring commands are WF-4's (RP-427).
import { createDb } from "@rabaed/db";
import { addTestWorkflow, testDatabaseUrls } from "@rabaed/db/test-support";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { all, buildTower, detail, draft, ok, projectMember, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const MAR = { name: { en: "Material Submittal (MAR)", ar: "اعتماد المواد (MAR)" }, versionNo: 2 };
const TOWER_ROUTE = { en: "Tower MAR route", ar: "مسار اعتماد المواد للبرج" };
const C2_ROUTE = { en: "C2's MAR route", ar: "مسار اعتماد المواد للمقاول الثاني" };

let at: Tower;
let c2Engineer: Caller;
let c2ParticipantId = "";
let k1Engineer: Caller;
let towerRoute = "";
let c2Route = "";

const run = (text: string) => sql.raw(text).execute(migrator);

const bindMar = (definitionId: string, raisingParticipantId: string | null = null) =>
  sql`
    insert into workflow_binding (project_id, work_item_type_id, raising_participant_id, workflow_definition_id)
    select ${at.projectId}::uuid, t.id, ${raisingParticipantId}::uuid, ${definitionId}::uuid
    from work_item_type t where t.owner_kind = 'rabaed' and t.code = 'MAR'
  `.execute(migrator);

beforeAll(async () => {
  const c1: Company = await api.projectCreator();
  const k1: Company = await api.authorizedPerson();
  const c2: Company = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "BND");
  c2ParticipantId = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: all, location: all }));
  c2Engineer = await projectMember(api, c2, c2ParticipantId, ["engineer"]);
  const k1ParticipantId = (await c1.caller.get(`/v1/projects/${at.projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean; id: string }) => !p.isOwnCompany && p.id !== c2ParticipantId).id;
  k1Engineer = await projectMember(api, k1, k1ParticipantId, ["engineer"]);
  towerRoute = await addTestWorkflow(run, { name: TOWER_ROUTE, owner: { kind: "project", projectId: at.projectId } });
  c2Route = await addTestWorkflow(run, { name: C2_ROUTE, owner: { kind: "project", projectId: at.projectId } });
});

describe("a new item's Workflow", () => {
  let before = "";

  it("is the Type's Rabaed Default while the Project binds none, read with its name and Version", async () => {
    before = await draft(at, at.c1Engineer, "Before binding");
    expect((await detail(at.c1Engineer, before)).workflow).toEqual(MAR);
  });

  it("is the Project's own once bound; an item created before keeps its Workflow and Version", async () => {
    await bindMar(towerRoute);
    const id = await draft(at, at.c1Engineer, "On the Tower's route");
    expect((await detail(at.c1Engineer, id)).workflow).toEqual({ name: TOWER_ROUTE, versionNo: 1 });
    expect((await detail(at.c1Engineer, before)).workflow).toEqual(MAR);
  });

  it("is the raiser's exception first: C2's items run C2's route, C1's the Project's (scenario RP-426-2)", async () => {
    await bindMar(c2Route, c2ParticipantId);
    const c2Item = await draft(at, c2Engineer, "C2's item");
    expect((await detail(c2Engineer, c2Item)).workflow).toEqual({ name: C2_ROUTE, versionNo: 1 });
    const c1Item = await draft(at, at.c1Engineer, "C1's item");
    expect((await detail(at.c1Engineer, c1Item)).workflow).toEqual({ name: TOWER_ROUTE, versionNo: 1 });
  });

  it("is a new Version only for items created after it is published", async () => {
    const earlier = await draft(at, at.c1Engineer, "On Version 1");
    await addTestWorkflow(run, { version: { definitionId: towerRoute, no: 2 } });
    const later = await draft(at, at.c1Engineer, "On Version 2");
    expect((await detail(at.c1Engineer, later)).workflow).toEqual({ name: TOWER_ROUTE, versionNo: 2 });
    expect((await detail(at.c1Engineer, earlier)).workflow).toEqual({ name: TOWER_ROUTE, versionNo: 1 });
  });
});

describe("scenario RP-426-1: the map is everyone's, an item's internal moves are not", () => {
  it("C1 reads its item's Workflow and Version, but not K1's internal move on it", async () => {
    const id = await draft(at, at.c1Engineer, "Internal moves");
    await take(at.c1Engineer, id, "send_for_review");
    await ok(at.c1Pm.post(`/v1/work-items/${id}/claim`));
    await take(at.c1Pm, id, "submit");
    await ok(k1Engineer.post(`/v1/work-items/${id}/claim`));
    // The MAR's "Consultant verification" is filled at `consultant_review`, a Step this Workflow has too.
    const answers = { ...(await detail(k1Engineer, id)).answers, sample_checked: true, matches_specification: true };
    await ok(k1Engineer.request("PUT", `/v1/work-items/${id}/answers`, { answers }));
    await take(k1Engineer, id, "send_to_manager");

    const moves = async (by: Caller) =>
      (await ok(by.get(`/v1/work-items/${id}/history`), 200)).json().events.flatMap((e: { transition: { en: string } | null }) =>
        e.transition ? [e.transition.en] : [],
      );
    expect(await moves(k1Engineer)).toContain("Send to Manager");
    expect(await moves(at.c1Pm)).not.toContain("Send to Manager");
    const asC1 = await detail(at.c1Pm, id);
    expect(asC1.step.key).toBe("consultant_review");
    // The same Workflow and Version for both, K1's internal Steps and all (V20).
    expect(asC1.workflow).toEqual({ name: TOWER_ROUTE, versionNo: 2 });
    expect((await detail(k1Engineer, id)).workflow).toEqual({ name: TOWER_ROUTE, versionNo: 2 });
  });
});
