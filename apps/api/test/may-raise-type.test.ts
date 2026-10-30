// Seam 1 for "+ New" (RP-1089): the Types a Member is offered are exactly the Types
// app.create_work_item accepts from them. Both read one rule, app.may_raise_type: a Draft
// held by the raiser asks that the Member's Positions hold its Function Permission, any
// other Draft that their base role is the Draft's role.
//
// One Project with a Participant of every base role; on each, a Member with each Rabaed
// Position of that role, and one with none.
import { rabaedDefaultTypes } from "@rabaed/admin/services";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { baseRoles, type BaseRole } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { all, bilingual, ok, projectMember, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

type Raiser = { label: string; caller: Caller };

/**
 * The Rabaed Default Types raised directly (a Comment is raised from an item only) and their
 * Modules. Not every Rabaed Type of the test database: other tests add their own.
 */
let defaults: string[] = [];
let modules: string[] = [];
let c1: Company;
let projectId = "";
let trade = "";
let location = "";
const raisers: Raiser[] = [];
let ownerPm: Caller;

beforeAll(async () => {
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  const post = async (path: string, body: unknown) => (await ok(c1.caller.post(`/v1/projects/${projectId}/${path}`, body), 201)).json().id as string;
  trade = await post("trades", { code: "EL", name: bilingual("Electrical") });
  location = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });

  const { rows: types } = await sql<{ code: string; module_key: string }>`
    select code, module_key from work_item_type
    where owner_kind = 'rabaed' and not raised_from_item_only and code = any(${rabaedDefaultTypes.map((t) => t.type)}::text[])
  `.execute(migrator);
  defaults = types.map((t) => t.code);
  modules = [...new Set(types.map((t) => t.module_key))];
  const { rows: positions } = await sql<{ base_role: BaseRole; key: string }>`
    select base_role, key from position where owner_kind = 'rabaed' order by base_role, key
  `.execute(migrator);

  for (const role of baseRoles) {
    let company: Company = c1;
    let participantId: string;
    if (role === "contractor") {
      participantId = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
        .json()
        .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
    } else {
      company = await api.authorizedPerson();
      participantId = await api.addParticipant(c1.caller, projectId, company.company, role);
    }
    await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
    for (const held of [...positions.filter((p) => p.base_role === role).map((p) => [p.key]), []]) {
      const caller = await projectMember(api, company, participantId, held);
      raisers.push({ label: `${role} ${held.join(",") || "(no Position)"}`, caller });
      if (role === "owner" && held[0] === "project_manager") ownerPm = caller;
    }
  }
});

/** The Rabaed Default Types "+ New" offers `by`, in every Module. */
async function offered(by: Caller): Promise<string[]> {
  const codes: string[] = [];
  for (const module of modules) {
    const { types } = (await ok(by.get(`/v1/projects/${projectId}/raisable-types?module=${module}`), 200)).json() as { types: { code: string }[] };
    codes.push(...types.map((t) => t.code).filter((c) => defaults.includes(c)));
  }
  return codes.sort();
}

/** The Rabaed Default Types app.create_work_item accepts a Draft of from `by`: 201, or refused 403. */
async function accepted(by: Caller): Promise<string[]> {
  const codes: string[] = [];
  for (const type of defaults) {
    const res = await by.post(`/v1/projects/${projectId}/work-items`, { type, title: `A ${type}`, answers: { trade, location } });
    expect([201, 403], `${type}: ${res.body}`).toContain(res.statusCode);
    if (res.statusCode === 201) codes.push(type);
  }
  return codes.sort();
}

describe("the Types '+ New' offers", () => {
  it("leave out a Draft held by the raiser when the Member's Positions lack its permission: the Owner's PM raises no Snag", async () => {
    expect(await offered(ownerPm)).not.toContain("SNG");
  });

  it("are the Types app.create_work_item accepts, for every Rabaed Position and base role", async () => {
    for (const { label, caller } of raisers) {
      expect(await offered(caller), label).toEqual(await accepted(caller));
    }
  });
});
