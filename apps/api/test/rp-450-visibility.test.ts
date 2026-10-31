// Seam 1 for the audit of the builder's commands (RP-450; visibility.md V9, V18; scenario RP-450-1).
// Each command Tower's Project Admin runs through the api (duplicate and publish a Workflow, add a
// Stage and an outcome, save and publish a Screen), and each TMC's Authorized Person runs on TMC's
// Library and defaults (copy and publish a Library Workflow, set and clear a default), leaves exactly
// one setup_event row, to Tower or to TMC. The same command refused (a plain Tower Member, Beta
// Build's Member on Tower, K1's Authorized Person) is the plain 404 and leaves none. The rows are
// counted with the migrator, by the Member who acted, so another suite's rows never count. That
// nobody reads or changes the table through the app role is seam 2's: workflow-authoring-rls,
// project-stages, outcome-sets, screens-rls and company-defaults-rls (packages/db/test).
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { LightMyRequestResponse } from "fastify";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { all, bilingual, buildTower, ok, projectMember, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

type Person = { caller: Caller; memberId: string; name: string };
type Audited = { id: string; kind: string; type: string; project_id: string | null; company_id: string | null };

let tmc: Company; // Tower's Host Company: its Authorized Person creates Tower and is its Project Admin.
let at: Tower;
let admin: Person; // TMC's Authorized Person.
let refusers: Person[]; // A plain Tower Member, Beta Build's Member, K1's Authorized Person.
let marTypeId = "";
let marWorkflowId = "";
let towerCopy = "";
let libraryCopy = "";
let screen = "";

const person = async (caller: Caller, name: string): Promise<Person> => ({ caller, memberId: (await ok(caller.get("/v1/me"), 200)).json().member.id, name });

/** The setup_event rows `by` has written, oldest first. */
const writtenBy = async (by: Person): Promise<Audited[]> =>
  (
    await sql<Audited>`
      select id, kind, type, project_id, company_id from setup_event where actor_member_id = ${by.memberId}::uuid order by created_at, id
    `.execute(migrator)
  ).rows;

/** `by` runs `command`, answered `status`, and leaves exactly the one row `expected`. Returns the answer. */
async function auditedOnce(by: Person, command: () => Promise<LightMyRequestResponse>, status: number, expected: Omit<Audited, "id">) {
  const before = new Set((await writtenBy(by)).map((r) => r.id));
  const res = await command();
  expect(res.statusCode, res.body).toBe(status);
  const added = (await writtenBy(by)).filter((r) => !before.has(r.id)).map(({ id: _id, ...row }) => row);
  expect(added, `${by.name}: ${expected.type}`).toEqual([expected]);
  return res;
}

/** Each refuser runs `command` and gets the plain 404, and leaves no row at all. */
async function refusedToAll(command: (by: Caller) => Promise<LightMyRequestResponse>, what: string) {
  for (const by of refusers) {
    const before = await writtenBy(by);
    await expectHidden(command(by.caller), `${by.name} ${what}`); // not hidden-from: a refused command; what it leaves in setup_event is the assert below
    expect(await writtenBy(by), `${by.name} ${what}`).toEqual(before);
  }
}

const toTower = (kind: string, type: string) => ({ kind, type, project_id: at.projectId, company_id: null });
const toTmc = (kind: string, type: string) => ({ kind, type, project_id: null, company_id: tmc.company.companyId });
const SCHEMA = { sections: [{ key: "reply", title: bilingual("Reply"), fields: [{ key: "remarks", type: "textarea", label: bilingual("Remarks") }] }] };

beforeAll(async () => {
  tmc = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1: tmc, k1 }, "AUD");
  const beta = await api.authorizedPerson();
  const betaParticipant = await api.addParticipant(tmc.caller, at.projectId, beta.company, "contractor");
  await ok(tmc.caller.request("PUT", `/v1/participants/${betaParticipant}/visibility`, { trade: all, location: all }));
  admin = await person(tmc.caller, "TMC's Authorized Person");
  refusers = [
    await person(at.c1Engineer, "a plain Tower Member"),
    await person(await projectMember(api, beta, betaParticipant, ["engineer"]), "Beta Build's Member"),
    await person(k1.caller, "K1's Authorized Person"),
  ];
  const mar = await sql<{ id: string; workflow_definition_id: string }>`
    select id, workflow_definition_id from work_item_type where owner_kind = 'rabaed' and code = 'MAR'
  `.execute(migrator);
  marTypeId = mar.rows[0]!.id;
  marWorkflowId = mar.rows[0]!.workflow_definition_id;
});

describe("scenario RP-450-1: each builder command leaves one setup_event row; a refused one leaves none", () => {
  it("duplicating a Workflow into Tower", async () => {
    await refusedToAll((by) => by.post(`/v1/workflows/${marWorkflowId}/duplicate`, { projectId: at.projectId, name: bilingual("Nope") }), "duplicates into Tower");
    const res = await auditedOnce(admin, () => tmc.caller.post(`/v1/workflows/${marWorkflowId}/duplicate`, { projectId: at.projectId, name: bilingual("Audited route") }), 201, toTower("workflow", "duplicated"));
    towerCopy = res.json().id;
  });

  it("publishing it", async () => {
    await refusedToAll((by) => by.post(`/v1/workflows/${towerCopy}/publish`), "publishes Tower's copy");
    await auditedOnce(admin, () => tmc.caller.post(`/v1/workflows/${towerCopy}/publish`), 200, toTower("workflow", "published"));
  });

  it("adding a Stage", async () => {
    const stage = (by: Caller) => by.post(`/v1/projects/${at.projectId}/modules/submittals/stages`, { key: "on_hold", name: bilingual("On Hold"), category: "in_progress" });
    await refusedToAll(stage, "adds a Stage");
    await auditedOnce(admin, () => stage(tmc.caller), 201, toTower("stage", "stage_added"));
  });

  it("adding an outcome", async () => {
    const outcome = (by: Caller) =>
      by.post(`/v1/projects/${at.projectId}/work-item-types/MAR/outcomes`, { code: "E", name: bilingual("On site"), closing: true, polarity: "positive", actions: [] });
    await refusedToAll(outcome, "adds an outcome");
    await auditedOnce(admin, () => outcome(tmc.caller), 201, toTower("outcome_set", "outcome_added"));
  });

  it("saving a Screen, and publishing it", async () => {
    const save = (by: Caller) => by.post(`/v1/projects/${at.projectId}/screens`, { key: "audited_reply", name: bilingual("Audited reply"), schema: SCHEMA, internalFields: [] });
    await refusedToAll(save, "saves a Screen");
    screen = (await auditedOnce(admin, () => save(tmc.caller), 201, toTower("screen", "screen_created"))).json().id;
    await refusedToAll((by) => by.post(`/v1/screens/${screen}/publish`), "publishes Tower's Screen");
    await auditedOnce(admin, () => tmc.caller.post(`/v1/screens/${screen}/publish`), 200, toTower("screen", "screen_published"));
  });

  it("copying a Workflow into TMC's Library, and publishing it", async () => {
    // K1's Authorized Person copying into a Library copies into K1's, so only TMC's own may refuse here.
    const plain = refusers[0]!;
    const before = await writtenBy(plain);
    await expectHidden(plain.caller.post(`/v1/workflows/${marWorkflowId}/duplicate`, { projectId: null, name: bilingual("Nope") })); // not hidden-from: a refused command; it left no row, below
    expect(await writtenBy(plain)).toEqual(before);
    const res = await auditedOnce(admin, () => tmc.caller.post(`/v1/workflows/${marWorkflowId}/duplicate`, { projectId: null, name: bilingual("TMC audited route") }), 201, toTmc("workflow", "duplicated"));
    libraryCopy = res.json().id;
    await refusedToAll((by) => by.post(`/v1/workflows/${libraryCopy}/publish`), "publishes TMC's Library copy");
    await auditedOnce(admin, () => tmc.caller.post(`/v1/workflows/${libraryCopy}/publish`), 200, toTmc("workflow", "published"));
  });

  it("setting a default, and clearing it", async () => {
    const set = (by: Caller) => by.request("PUT", "/v1/company-defaults", { kind: "workflow", workItemTypeId: marTypeId, itemId: libraryCopy });
    await refusedToAll(set, "sets TMC's default");
    await auditedOnce(admin, () => set(tmc.caller), 204, toTmc("company_default", "default_set"));
    // Clearing is of the caller's own Company's default: K1's Authorized Person would clear K1's, so only the two who are no Authorized Person refuse here.
    const clear = (by: Caller) => by.request("DELETE", `/v1/company-defaults?kind=workflow&workItemTypeId=${marTypeId}`);
    for (const by of refusers.slice(0, 2)) {
      const before = await writtenBy(by);
      await expectHidden(clear(by.caller), `${by.name} clears a default`); // not hidden-from: a refused command; it left no row, below
      expect(await writtenBy(by)).toEqual(before);
    }
    await auditedOnce(admin, () => clear(tmc.caller), 204, toTmc("company_default", "default_cleared"));
  });
});
