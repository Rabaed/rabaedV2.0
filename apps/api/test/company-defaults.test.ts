// Seam 1 for Company defaults (RP-517; spec RP-511 decision 8; ADR 0019 and 0016;
// workflow-engine.md "Company defaults"; visibility.md V18, scenario RP-517-1). The
// Authorized Person of a Company marks Library Workflows, Screens and Forms as its defaults
// per Work Item Type; a Project the Company creates starts from them, Type by Type, else
// from the Rabaed Defaults; a Company joining it gets nothing copied and runs the Project's
// copies, with no exception. Library Screens and Forms have no api yet (the Library is
// RP-442), so the migrator writes those; the Workflow is copied through the api.
import { submittalWorkflows } from "@rabaed/admin/services";
import { createDb } from "@rabaed/db";
import { expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import type { CompanyDefaults, ScreenList } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, readById, type Caller } from "./support/harness.ts";
import { buildTower, detail, draft, ok, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const label = (en: string) => ({ en, ar: en });
// The MAR's Rabaed Default, 2→2 (RP-596), on Workflow Version 3 since RP-437 (ADR 0020). The tests raise the
// MAR itself (`{ type: "MAR" }`): `draft` raises the legacy MAR by default, a Type of its own.
const MAR = { name: submittalWorkflows[3].name, versionNo: 3 };
const TMC_ROUTE = label("TMC MAR route");
const reply = {
  sections: [{ key: "reply", title: label("Reply"), fields: [{ key: "remarks", type: "textarea", label: label("Remarks") }] }],
};

let tmc: Company; // Creates Projects; its Authorized Person marks the defaults.
let k1: Company; // Beta Build: joins; has a default of its own that must not follow it.
let nobody: Company; // Another Project Creator, with no defaults and no Library.
let marTypeId = "";
let marWorkflowId = "";
let tmcRoute = "";
let k1Route = "";
let tmcScreen = "";
let tmcForm = "";

const defaults = async (by: Company): Promise<CompanyDefaults> => (await ok(by.caller.get("/v1/company-defaults"), 200)).json();
const run = (text: string) => sql.raw(text).execute(migrator);
/** The items a Caller's Company has marked as defaults, by item id, for expectHiddenFrom (RP-1095). */
const defaultItems = async (by: Caller) =>
  (await ok(by.get("/v1/company-defaults"), 200)).json().defaults.map((d: { itemId: string }) => ({ id: d.itemId })) as { id: string }[];
/** Who a Caller is, in a failure. */
const who = (by: Caller) => (by === tmc.caller ? "TMC" : by === k1.caller ? "Beta Build" : by === nobody.caller ? "the Company with no defaults" : "someone");

/** A Workflow in `by`'s Library: a published copy of the MAR's Rabaed Default. */
async function libraryRoute(by: Company, name: { en: string; ar: string }): Promise<string> {
  const copy = await ok(by.caller.post(`/v1/workflows/${marWorkflowId}/duplicate`, { projectId: null, name }), 201);
  const id = copy.json().id as string;
  await ok(by.caller.post(`/v1/workflows/${id}/publish`), 200);
  return id;
}

const setDefault = (by: Company, kind: string, itemId: string, workItemTypeId = marTypeId) =>
  by.caller.request("PUT", "/v1/company-defaults", { kind, workItemTypeId, itemId });

/** The Project's own Workflows and the default binding, as the database holds them. */
async function projectWorkflows(projectId: string) {
  const defs = await sql<{ name: { en: string }; work_item_type_id: string; published: number }>`
    select d.name, d.work_item_type_id,
      (select count(*)::int from workflow_version v where v.workflow_definition_id = d.id and v.status = 'published') as published
    from workflow_definition d where d.owner_kind = 'project' and d.project_id = ${projectId}::uuid
  `.execute(migrator);
  const bindings = await sql<{ raising_participant_id: string | null; name: { en: string } }>`
    select b.raising_participant_id, d.name from workflow_binding b
    join workflow_definition d on d.id = b.workflow_definition_id where b.project_id = ${projectId}::uuid
  `.execute(migrator);
  return { definitions: defs.rows, bindings: bindings.rows };
}

beforeAll(async () => {
  tmc = await api.projectCreator();
  k1 = await api.authorizedPerson();
  nobody = await api.projectCreator();
  const mar = await sql<{ id: string; workflow_definition_id: string }>`
    select id, workflow_definition_id from work_item_type where owner_kind = 'rabaed' and code = 'MAR'
  `.execute(migrator);
  marTypeId = mar.rows[0]!.id;
  marWorkflowId = mar.rows[0]!.workflow_definition_id;
  tmcRoute = await libraryRoute(tmc, TMC_ROUTE);
  k1Route = await libraryRoute(k1, label("Beta Build MAR route"));

  // A Screen and a Form in TMC's Library, published (no api writes them yet).
  const key = `tmc_reply_${Math.random().toString(36).slice(2, 8)}`;
  const ids = await sql<{ screen_id: string; form_id: string }>`
    with s as (
      insert into screen (owner_kind, company_id, key, name) values ('company', ${tmc.company.companyId}::uuid, ${key}, ${JSON.stringify(label("TMC reply"))}::jsonb)
      returning id
    ), sv as (
      insert into screen_version (screen_id, version_no, status, schema, internal_fields, published_at)
      select id, 1, 'published', ${JSON.stringify(reply)}::jsonb, '{}', now() from s
    ), f as (
      insert into form_definition (owner_kind, company_id, name, work_item_type_id)
      values ('company', ${tmc.company.companyId}::uuid, ${JSON.stringify(label("TMC MAR form"))}::jsonb, ${marTypeId}::uuid)
      returning id
    ), fv as (
      insert into form_version (form_definition_id, version_no, status, schema, published_at)
      -- The Rabaed Default MAR Form's fields: new MARs on a Project created from it are filled in on it (RP-554).
      select f.id, 1, 'published', r.schema, now() from f, form_version r where r.id = app.latest_form_version('MAR')
    )
    select (select id from s) as screen_id, (select id from f) as form_id
  `.execute(migrator);
  tmcScreen = ids.rows[0]!.screen_id;
  tmcForm = ids.rows[0]!.form_id;
});

describe("marking a default", () => {
  it("is for the Company's Authorized Person, of an item in its own Library", async () => {
    const plain = await api.member(tmc.caller);
    // Anyone else, another Company's item or a made-up one is the same 404 (V18).
    await expectHidden(setDefault({ ...tmc, caller: plain.caller }, "workflow", tmcRoute)); // not hidden-from: TMC's own Member who isn't the Authorized Person, refused as the same 404
    // TMC's Library Workflow is there for TMC, and not for the other Companies that try to mark it.
    await expectHiddenFrom({ read: readById(`/v1/workflows/${tmcRoute}`), target: tmcRoute, seenBy: tmc.caller, hiddenFrom: [k1.caller, nobody.caller], name: who });
    await expectHidden(setDefault(k1, "workflow", tmcRoute)); // not hidden-from: the write's plain 404; the Workflow is proven TMC's just above
    await expectHidden(setDefault(nobody, "workflow", tmcRoute)); // not hidden-from: the write's plain 404; the Workflow is proven TMC's just above
    await expectHidden(setDefault(tmc, "workflow", "00000000-0000-4000-8000-000000000000")); // not hidden-from: a made-up id, no row to prove
    await expectHidden(setDefault(tmc, "workflow", marWorkflowId)); // not hidden-from: a Rabaed Default, not in TMC's Library, refused as the same 404
    await expectHidden(setDefault(tmc, "workflow", tmcRoute, "00000000-0000-4000-8000-000000000000")); // not hidden-from: a made-up Work Item Type, no row to prove
    await expectHidden(plain.caller.request("DELETE", `/v1/company-defaults?kind=workflow&workItemTypeId=${marTypeId}`)); // not hidden-from: TMC's own Member who isn't the Authorized Person, refused as the same 404
    expect((await defaults(tmc)).defaults).toEqual([]); // not hidden-from: TMC's own list; none of the refused writes marked a default
  });

  it("is refused for a Workflow with nothing published, or made for another Type", async () => {
    const copy = await ok(tmc.caller.post(`/v1/workflows/${marWorkflowId}/duplicate`, { projectId: null, name: label("TMC unfinished") }), 201);
    const unfinished = await setDefault(tmc, "workflow", copy.json().id);
    expect({ status: unfinished.statusCode, error: unfinished.json().error }).toEqual({ status: 409, error: "not_published" });
    const other = await sql<{ id: string }>`select id from work_item_type where owner_kind = 'rabaed' and code <> 'MAR' limit 1`.execute(migrator);
    const wrong = await setDefault(tmc, "workflow", tmcRoute, other.rows[0]!.id);
    expect({ status: wrong.statusCode, error: wrong.json().error }).toEqual({ status: 422, error: "not_for_type" });
    expect((await defaults(tmc)).defaults).toEqual([]); // not hidden-from: TMC's own list; the refused writes marked no default
  });

  it("holds one default per Type and kind, which the Company's Members read", async () => {
    const first = await setDefault(tmc, "workflow", tmcRoute);
    expect(first.statusCode, first.body).toBe(204);
    const spare = await libraryRoute(tmc, label("TMC spare route"));
    await ok(setDefault(tmc, "workflow", spare));
    await ok(setDefault(tmc, "workflow", tmcRoute));
    await ok(setDefault(tmc, "screen", tmcScreen));
    await ok(setDefault(tmc, "form", tmcForm));
    const member = await api.member(tmc.caller);
    const read: CompanyDefaults = (await ok(member.caller.get("/v1/company-defaults"), 200)).json();
    expect(read.defaults.map((d) => ({ kind: d.kind, code: d.workItemTypeCode, itemId: d.itemId, name: d.name.en }))).toEqual([ // not hidden-from: the Company's own defaults, compared by item id with their names
      { kind: "form", code: "MAR", itemId: tmcForm, name: "TMC MAR form" },
      { kind: "screen", code: "MAR", itemId: tmcScreen, name: "TMC reply" },
      { kind: "workflow", code: "MAR", itemId: tmcRoute, name: "TMC MAR route" },
    ]);
  });
});

describe("a Project starts from its creator's Company defaults", () => {
  let at: Awaited<ReturnType<typeof buildTower>>;

  beforeAll(async () => {
    await ok(setDefault(k1, "workflow", k1Route));
    at = await buildTower(api, { c1: tmc, k1 }, "CD1");
  });

  it("runs TMC's copy of the Workflow for its MARs; Beta Build joining gets the Project's copy, no exception", async () => {
    const id = await draft(at, at.c1Engineer, "Cable tray", { type: "MAR" });
    expect((await detail(at.c1Engineer, id)).workflow).toEqual({ name: TMC_ROUTE, versionNo: 1 });

    // One Workflow and one binding on the Project, for every raiser: nothing of Beta Build's followed it.
    const { definitions, bindings } = await projectWorkflows(at.projectId);
    expect(definitions).toMatchObject([{ name: TMC_ROUTE, work_item_type_id: marTypeId, published: 1 }]);
    expect(bindings).toEqual([{ raising_participant_id: null, name: TMC_ROUTE }]);
  });

  it("copies the default Screen and Form as the Project's own", async () => {
    const screens: ScreenList = (await ok(at.c1Engineer.get(`/v1/projects/${at.projectId}/screens`), 200)).json();
    expect(screens.screens).toContainEqual(expect.objectContaining({ owner: "project", name: label("TMC reply"), latestVersionNo: 1 }));
    const forms = await sql<{ name: { en: string }; work_item_type_id: string; versions: number }>`
      select f.name, f.work_item_type_id,
        (select count(*)::int from form_version v where v.form_definition_id = f.id and v.status = 'published') as versions
      from form_definition f where f.owner_kind = 'project' and f.project_id = ${at.projectId}::uuid
    `.execute(migrator);
    expect(forms.rows).toEqual([{ name: label("TMC MAR form"), work_item_type_id: marTypeId, versions: 1 }]);
  });

  it("is independent of the Library: a later Library change or a cleared default leaves the Project's copy", async () => {
    await ok(tmc.caller.request("DELETE", `/v1/company-defaults?kind=workflow&workItemTypeId=${marTypeId}`));
    const id = await draft(at, at.c1Engineer, "Conduit", { type: "MAR" });
    expect((await detail(at.c1Engineer, id)).workflow).toEqual({ name: TMC_ROUTE, versionNo: 1 });
    expect((await defaults(tmc)).defaults.map((d) => d.kind)).toEqual(["form", "screen"]);

    // A Project created now has no Workflow default for the Type: the Rabaed Default again.
    const later = await buildTower(api, { c1: tmc, k1 }, "CD2");
    expect((await detail(later.c1Engineer, await draft(later, later.c1Engineer, "Pipes", { type: "MAR" }))).workflow).toEqual(MAR);
    expect((await projectWorkflows(later.projectId)).bindings).toEqual([]); // not hidden-from: read as the migrator; the new Project has no Workflow of its own to bind
    await ok(setDefault(tmc, "workflow", tmcRoute));
  });

  it("leaves a Company with no defaults on the Rabaed Defaults, as before", async () => {
    const plain = await buildTower(api, { c1: nobody, k1 }, "CD3");
    expect((await detail(plain.c1Engineer, await draft(plain, plain.c1Engineer, "Ducts", { type: "MAR" }))).workflow).toEqual(MAR);
    const { definitions, bindings } = await projectWorkflows(plain.projectId);
    expect({ definitions, bindings }).toEqual({ definitions: [], bindings: [] });
    const screens: ScreenList = (await ok(plain.c1Engineer.get(`/v1/projects/${plain.projectId}/screens`), 200)).json();
    expect(screens.screens.filter((s) => s.owner === "project")).toEqual([]); // not hidden-from: the Project's own Screens, none copied with no defaults
  });

  it("copies a Library Screen a default Workflow names, so the Project's copy pins what the Library's did (scenario RP-517-1 setup)", async () => {
    // TMC's Library Workflow shows a Library Screen that is not itself a default.
    const key = `named_reply_${Math.random().toString(36).slice(2, 8)}`;
    await run(`
      with s as (
        insert into screen (owner_kind, company_id, key, name)
        values ('company', '${tmc.company.companyId}', '${key}', '{"en": "Named reply", "ar": "رد"}') returning id
      )
      insert into screen_version (screen_id, version_no, status, schema, internal_fields, published_at)
      select id, 1, 'published', '${JSON.stringify(reply)}'::jsonb, '{}', now() from s`);
    const route = await libraryRoute(tmc, label("TMC screened route"));
    const read = (await ok(tmc.caller.get(`/v1/workflows/${route}`), 200)).json();
    const withScreen = {
      ...read.published.definition,
      transitions: read.published.definition.transitions.map((t: { key: string }) => (t.key === "approve_a" ? { ...t, actionForm: null, screen: key } : t)),
    };
    await ok(tmc.caller.request("PUT", `/v1/workflows/${route}/draft`, { definition: withScreen }), 200);
    await ok(tmc.caller.post(`/v1/workflows/${route}/publish`), 200);
    await ok(setDefault(tmc, "workflow", route));
    const screened = await buildTower(api, { c1: tmc, k1 }, "CD4");
    const screens: ScreenList = (await ok(screened.c1Engineer.get(`/v1/projects/${screened.projectId}/screens`), 200)).json();
    expect(screens.screens).toContainEqual(expect.objectContaining({ key, owner: "project", latestVersionNo: 1 }));
    const pinned = await sql<{ pinned: number }>`
      select count(*)::int as pinned from workflow_transition t
      join workflow_version v on v.id = t.workflow_version_id
      join workflow_definition d on d.id = v.workflow_definition_id
      join screen_version sv on sv.id = t.screen_version_id
      join screen s on s.id = sv.screen_id
      where d.project_id = ${screened.projectId}::uuid and t.screen_key = ${key} and s.owner_kind = 'project'
    `.execute(migrator);
    expect(pinned.rows[0]!.pinned).toBe(1);
    await ok(setDefault(tmc, "workflow", tmcRoute));
  });
});

describe("another Company never reads TMC's defaults or Library items (scenario RP-517-1, V18)", () => {
  it("sees none of them, by the list or the Library items; the seeded Project is the Project's, not the Library's", async () => {
    expect((await defaults(k1)).defaults.map((d) => d.itemId)).toEqual([k1Route]);
    expect((await defaults(nobody)).defaults).toEqual([]); // not hidden-from: a Company that marked none has none; TMC's are proven hidden from it below
    const outsiders = [k1.caller, nobody.caller];
    // TMC's defaults are on TMC's list, and never on another Company's.
    for (const target of [tmcRoute, tmcScreen, tmcForm]) await expectHiddenFrom({ read: defaultItems, target, seenBy: tmc.caller, hiddenFrom: outsiders, name: who });
    await expectHiddenFrom({ read: readById(`/v1/workflows/${tmcRoute}`), target: tmcRoute, seenBy: tmc.caller, hiddenFrom: outsiders, name: who });
    await expectHiddenFrom({ read: readById(`/v1/screens/${tmcScreen}`), target: tmcScreen, seenBy: tmc.caller, hiddenFrom: outsiders, name: who });
    // Marking another Company's Library item, or reading its Project copy as a default, names nothing.
    await expectHidden(setDefault(k1, "screen", tmcScreen)); // not hidden-from: the write's plain 404; the Screen is proven TMC's just above
    await expectHidden(setDefault(k1, "form", tmcForm)); // not hidden-from: the write's plain 404; the Form is proven TMC's default just above
  });
});
