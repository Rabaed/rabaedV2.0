// Seam 1 for visibility on a Workflow the Project made itself, not a Rabaed Default (RP-1095,
// scenario RP-1095-1; visibility.md V1, V3, V5). The Project's Admin binds a Type to the
// Project's own Workflow through the api; the item runs on it, and every "hidden" is proved with
// expectHiddenFrom: a reader who may see the row reads it first, by id. Seam 2:
// packages/db/test/custom-workflow-rls.test.ts.
import { randomInt } from "node:crypto";
import { sql } from "kysely";
import { createDb } from "@rabaed/db";
import { addTestWorkflow, expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import type { WorkItemHistory } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, readById, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { all, bilingual, buildTower, ok, only, projectMember, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi();
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("");
const TYPE = `RV${letters(3)}`;
const schema = {
  sections: [
    {
      key: "material",
      title: bilingual("Material"),
      fields: [{ key: "model", type: "text", label: bilingual("Model") }],
    },
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

let c1: Company;
let at: Tower;
let k1Engineer: Caller;
let c2Engineer: Caller; // Another Contractor, covering Building B only, where the item is: only V3 keeps it out.
let projectWorkflow = "";
let item = "";

const names = new Map<Caller, string>();
const named = (by: Caller) => names.get(by) ?? "someone";

type HistoryEvent = WorkItemHistory["events"][number];
/** The item's history as `by` reads it, or [] for the plain 404; an event is known by its time, since `seq` counts only what the reader sees. */
const history = async (by: Caller): Promise<HistoryEvent[]> => (await readById<WorkItemHistory>(`/v1/work-items/${item}/history`)(by)).flatMap((h) => h.events);
const eventAt = (event: HistoryEvent) => new Date(event.at).toISOString();
/** The time of the item's last event, as the migrator reads it. */
const lastEventAt = async () =>
  (
    await sql<{ at: Date }>`select created_at as at from work_item_event where work_item_id = ${item}::uuid order by seq desc limit 1`.execute(migrator)
  ).rows[0]!.at.toISOString();

beforeAll(async () => {
  await addSendBackType(migrator, TYPE, bilingual("Custom Workflow (RP-1095)"), schema);
  const typeId = (await sql<{ id: string }>`select id from work_item_type where code = ${TYPE}`.execute(migrator)).rows[0]!.id;

  c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "RCV");
  k1Engineer = await projectMember(api, k1, at.k1ParticipantId!, ["engineer"]);
  const buildingB = (await ok(c1.caller.post(`/v1/projects/${at.projectId}/locations`, { code: "BB", name: bilingual("Building B"), parentId: null }), 201)).json().id;
  const c2 = await api.authorizedPerson();
  const c2Participant = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2Participant}/visibility`, { trade: all, location: only(buildingB) }));
  c2Engineer = await projectMember(api, c2, c2Participant, ["engineer"]);
  for (const [by, name] of [[at.c1Engineer, "C1 engineer"], [at.c1Pm, "C1 PM"], [k1Engineer, "K1 engineer"], [at.k1Manager, "K1 manager"], [c2Engineer, "C2 engineer"]] as const) names.set(by, name);

  // The Project's own Workflow, with a Contractor Engineer Step the Default lacks; C1's Admin binds the Type to it.
  projectWorkflow = await addTestWorkflow((text) => sql.raw(text).execute(migrator), {
    name: bilingual(`RP-1095 Tower's own ${letters(6)}`),
    owner: { kind: "project", projectId: at.projectId },
    engineerStep: true,
  });
  // Made for the Type, as authoring one on the Project makes it.
  await sql`update workflow_definition set work_item_type_id = ${typeId}::uuid where id = ${projectWorkflow}::uuid`.execute(migrator);
  await ok(c1.caller.request("PUT", `/v1/projects/${at.projectId}/workflow-bindings`, { workItemTypeId: typeId, raisingParticipantId: null, workflowId: projectWorkflow }));

  const answers = { model: "CT-1", trade: at.electrical, location: buildingB };
  item = (await ok(at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, { type: TYPE, title: "Cable trays", answers }), 201)).json().id as string;
  await take(at.c1Engineer, item, "send_for_review");
});

describe("scenario RP-1095-1: a Project's own Workflow", () => {
  it("runs the item: it is pinned to the Project's Workflow, not the Type's Default", async () => {
    const { rows } = await sql<{ definition: string }>`
      select v.workflow_definition_id as definition from work_item w join workflow_version v on v.id = w.workflow_version_id where w.id = ${item}::uuid`.execute(migrator);
    expect(rows[0]!.definition).toBe(projectWorkflow);
  });

  it("keeps the item in C1's review from K1 (V1), then from C2 once Submitted (V3)", async () => {
    const read = readById(`/v1/work-items/${item}`);
    await expectHiddenFrom({ read, target: item, seenBy: at.c1Engineer, hiddenFrom: [at.k1Manager, k1Engineer, c2Engineer], name: named, label: "in C1's review" });

    await ok(at.c1Pm.post(`/v1/work-items/${item}/pick-up`));
    await take(at.c1Pm, item, "submit");
    const submit = await lastEventAt();
    await expectHiddenFrom({ read, target: item, seenBy: [at.c1Pm, at.k1Manager, k1Engineer], hiddenFrom: c2Engineer, name: named, label: "Submitted" });
    await expectHiddenFrom({ read: history, target: submit, seenBy: [at.c1Pm, k1Engineer], hiddenFrom: c2Engineer, idOf: eventAt, name: named, label: "C1's Submit" });
  });

  it("keeps K1's send to its Manager inside K1 (V5)", async () => {
    await ok(k1Engineer.post(`/v1/work-items/${item}/pick-up`));
    await take(k1Engineer, item, "send_to_manager");
    const sent = await lastEventAt();
    await expectHiddenFrom({
      read: history,
      target: sent,
      seenBy: [at.k1Manager, k1Engineer],
      hiddenFrom: [at.c1Pm, at.c1Engineer],
      idOf: eventAt,
      name: named,
      label: "K1's send to its Manager",
    });
    expect((await history(at.k1Manager)).find((e) => eventAt(e) === sent)).toMatchObject({ type: "transition", audience: "internal" });
  });
});
