// Seam 1 for the Form's `option_list` field, also as a table column (RP-282,
// spec RP-278; form-engine.md §2, §10): a Form picks from an Option List that
// Rabaed Admin keeps up to date, without a new Form Version. An option added in
// Admin is offered at once; a retired one stays on an answer that holds it (and
// saves again unchanged, even leaving Draft) but is refused for a new choice.
//
// The MAR Form Version 1 has no such field, so this file adds a test-only Rabaed
// Default Type (the MAR's Workflow) whose Form has them, over a test-only list.
import { randomUUID } from "node:crypto";
import { addOption, setOptionRetired } from "@rabaed/admin/services";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { FormVersion, OptionList } from "@rabaed/domain";
import type { LightMyRequestResponse } from "fastify";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { detail, projectMember, tryTake } from "./support/tower.ts";

const api = await createTestApi();
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
const adminDb = createDb(testDatabaseUrls().admin, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
  await adminDb.destroy();
});

const TYPE = "MAROL";
const LIST = "00000000-0000-4000-8000-000000000282";
const bilingual = (text: string) => ({ en: text, ar: `${text} (ع)` });
const all = { isAll: true, valueIds: [] };
const run = randomUUID().slice(0, 8);

const schema = {
  sections: [
    {
      key: "material",
      title: { en: "Material", ar: "المادة" },
      fields: [
        { key: "finish", type: "option_list", list: LIST, depth: 3, label: { en: "Finish", ar: "التشطيب" } },
        { key: "kinds", type: "option_list", list: LIST, depth: 1, multiple: true, label: { en: "Kinds", ar: "الأنواع" } },
        {
          key: "items",
          type: "table",
          label: { en: "Items", ar: "البنود" },
          columns: [
            { key: "name", type: "text", label: { en: "Name", ar: "الاسم" } },
            { key: "kind", type: "option_list", list: LIST, depth: 2, label: { en: "Kind", ar: "النوع" } },
          ],
        },
      ],
    },
    {
      // The Built-in Fields every Form places (RP-270).
      key: "classification",
      title: { en: "Classification", ar: "التصنيف" },
      fields: [
        { key: "trade", type: "trade", label: { en: "Trade", ar: "التخصص" } },
        { key: "location", type: "location", label: { en: "Location", ar: "الموقع" } },
        { key: "scopes", type: "scopes", label: { en: "Scopes", ar: "النطاقات" } },
      ],
    },
  ],
};

/** The test-only list: cables > copper > two5, and cables > fibre; added once, whatever the run. */
async function addList() {
  await sql`
    insert into option_list (id, name) values (${LIST}::uuid, '{"en": "Materials (test)", "ar": "مواد (اختبار)"}')
    on conflict do nothing
  `.execute(migrator);
  const option = async (value: string, parent: string | null) => {
    await sql`
      insert into option (option_list_id, parent_id, value, label)
      values (${LIST}::uuid, ${parent}::uuid, ${value}, ${JSON.stringify(bilingual(value))}::jsonb)
      on conflict (option_list_id, value) do nothing
    `.execute(migrator);
    const { rows } = await sql<{ id: string }>`select id from option where option_list_id = ${LIST}::uuid and value = ${value}`.execute(migrator);
    return rows[0]!.id;
  };
  const cables = await option("cables", null);
  await option("fibre", cables);
  await option("two5", await option("copper", cables));
  await option("trays", null);
}

/** The test-only Rabaed Default Type, with the Form above, following the MAR's Workflow. */
async function addType() {
  await sql`
    do $$
      declare
        v_definition uuid;
      begin
        if exists (select 1 from work_item_type where owner_kind = 'rabaed' and code = ${sql.lit(TYPE)}) then
          return;
        end if;
        insert into form_definition (owner_kind, name)
        values ('rabaed', '{"en": "Option list (test)", "ar": "قائمة خيارات (اختبار)"}')
        returning id into v_definition;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_definition, 1, 'published', now(), ${sql.lit(JSON.stringify(schema))}::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        select 'rabaed', module_key, ${sql.lit(TYPE)}, '{"en": "Option list submittal", "ar": "اعتماد قائمة خيارات"}',
          workflow_definition_id, outcome_kind, v_definition
        from work_item_type where owner_kind = 'rabaed' and code = 'MAR';
      end
    $$
  `.execute(migrator);
}

let engineer: Caller;
let engineerId = "";
let projectId = "";
let electrical = "";
let buildingA = "";

async function ok(res: Promise<LightMyRequestResponse>, status = 204) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
  return r;
}

const builtIns = () => ({ trade: electrical, location: buildingA });
const createDraft = (answers: Record<string, unknown>) =>
  engineer.post(`/v1/projects/${projectId}/work-items`, { type: TYPE, title: "Finishes", answers: { ...builtIns(), ...answers } });
const save = (id: string, answers: Record<string, unknown>) =>
  engineer.request("PUT", `/v1/work-items/${id}/answers`, { answers: { ...builtIns(), ...answers } });
const answersOf = async (id: string) => {
  const { trade: _trade, location: _location, ...own } = (await detail(engineer, id)).answers;
  return own;
};
const formVersionNo = async () =>
  ((await ok(engineer.get(`/v1/projects/${projectId}/work-item-types/${TYPE}/form`), 200)).json() as FormVersion).versionNo;
const refusal = (res: LightMyRequestResponse) => ({ status: res.statusCode, body: res.json() });

/** A new option in Rabaed Admin, by an Engineer with a reason; returns its value. */
async function addedInAdmin(parentValue: string | null, retired = false) {
  const value = `opt-${randomUUID().slice(0, 8)}`;
  const lists = (await ok(engineer.get("/v1/option-lists"), 200)).json().optionLists as OptionList[];
  const find = (nodes: OptionList["options"], v: string): string | null =>
    nodes.flatMap((n) => (n.value === v ? [n.id] : [find(n.options, v)])).find((id) => id) ?? null;
  const parentId = parentValue ? find(lists.find((l) => l.id === LIST)!.options, parentValue) : null;
  const added = await addOption(adminDb, engineerId, LIST, { parentId, value, label: bilingual(value), reason: `Seam test ${run}` });
  if (!added.ok) throw new Error(added.reason);
  if (retired) await setOptionRetired(adminDb, engineerId, added.value, true, `Seam test ${run}`);
  return value;
}

beforeAll(async () => {
  await addList();
  await addType();
  engineerId = await api.engineer();
  const c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  electrical = (await c1.caller.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") })).json().id;
  buildingA = (await c1.caller.post(`/v1/projects/${projectId}/locations`, { code: "BA", name: bilingual("Building A"), parentId: null }))
    .json().id;
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  // The engineer raises the items; a Project Manager holds Internal Review once they are sent.
  engineer = await projectMember(api, c1, own, ["engineer"]);
  await projectMember(api, c1, own, ["project_manager"]);
});

describe("an option added in Rabaed Admin", () => {
  it("is offered in the Project's Form at once, with no new Form Version", async () => {
    const before = await formVersionNo();
    const id = (await ok(createDraft({}), 201)).json().id as string;
    const rejected = await save(id, { finish: "opt-not-added-yet" });
    expect(rejected.json().fields).toEqual([{ key: "finish", code: "unknown_option" }]);

    const fresh = await addedInAdmin("copper");
    await ok(save(id, { finish: fresh, kinds: ["cables"], items: [{ name: "Run", kind: "trays" }] }));
    expect(await answersOf(id)).toEqual({ finish: fresh, kinds: ["cables"], items: [{ name: "Run", kind: "trays" }] });
    expect(await formVersionNo()).toBe(before);
  });

  it("is offered as a new first-level choice in the same way", async () => {
    const fresh = await addedInAdmin(null);
    const id = (await ok(createDraft({ kinds: [fresh] }), 201)).json().id as string;
    expect((await answersOf(id)).kinds).toEqual([fresh]);
  });
});

describe("a retired option", () => {
  it("stays on an answer that holds it, which saves again unchanged and still leaves Draft", async () => {
    const value = await addedInAdmin("copper");
    const id = (await ok(createDraft({ finish: value, items: [{ name: "Run", kind: "fibre" }] }), 201)).json().id as string;
    const answers = { finish: value, items: [{ name: "Run", kind: "fibre" }] };
    const inTheTable = await addedInAdmin("cables");
    await ok(save(id, { ...answers, items: [{ name: "Run", kind: inTheTable }] }));

    await setOptionRetired(adminDb, engineerId, (await optionId(value)), true, `Seam test ${run}`);
    await setOptionRetired(adminDb, engineerId, (await optionId(inTheTable)), true, `Seam test ${run}`);
    const held = { finish: value, items: [{ name: "Run", kind: inTheTable }] };
    await ok(save(id, held));
    expect(await answersOf(id)).toEqual(held);
    await ok(tryTake(engineer, id, "send_for_review"));
  });

  it("is refused for a new choice, in a field, a list and a table cell", async () => {
    const value = await addedInAdmin("copper", true);
    const res = await createDraft({ finish: value });
    expect(refusal(res)).toEqual({ status: 422, body: { error: "invalid_answers", fields: [{ key: "finish", code: "unknown_option" }] } });
    const kind = await addedInAdmin(null, true);
    expect((await createDraft({ kinds: [kind] })).json().fields).toEqual([{ key: "kinds", code: "unknown_option" }]);
    expect((await createDraft({ items: [{ name: "Run", kind }] })).json().fields).toEqual([
      { key: "items", code: "unknown_option", row: 0, column: "kind" },
    ]);
  });

  it("can be changed away from, and can't be chosen again once let go of", async () => {
    const value = await addedInAdmin("copper");
    const id = (await ok(createDraft({ finish: value }), 201)).json().id as string;
    await setOptionRetired(adminDb, engineerId, await optionId(value), true, `Seam test ${run}`);
    await ok(save(id, { finish: "two5" }));
    expect((await save(id, { finish: value })).json().fields).toEqual([{ key: "finish", code: "unknown_option" }]);
  });
});

describe("depth and single or multiple choice", () => {
  it("lets a Draft stop half way down, and blocks leaving Draft until it reaches the depth", async () => {
    const id = (await ok(createDraft({ finish: "cables" }), 201)).json().id as string;
    expect(refusal(await tryTake(engineer, id, "send_for_review"))).toEqual({
      status: 422,
      body: { error: "form_incomplete", fields: [{ key: "finish", code: "too_shallow" }] },
    });
    await ok(save(id, { finish: "two5" }));
    await ok(tryTake(engineer, id, "send_for_review"));
  });

  it("takes a branch that ends sooner than the depth", async () => {
    const id = (await ok(createDraft({ finish: "trays" }), 201)).json().id as string;
    await ok(tryTake(engineer, id, "send_for_review"));
  });

  it("refuses an option below a field's depth, and a list where one is wanted (and the reverse)", async () => {
    expect((await createDraft({ kinds: ["copper"] })).json().fields).toEqual([{ key: "kinds", code: "unknown_option" }]);
    expect((await createDraft({ finish: ["cables"] })).json().fields).toEqual([{ key: "finish", code: "wrong_type" }]);
    expect((await createDraft({ kinds: "cables" })).json().fields).toEqual([{ key: "kinds", code: "wrong_type" }]);
    expect((await createDraft({ kinds: ["cables", "cables"] })).json().fields).toEqual([{ key: "kinds", code: "wrong_type" }]);
  });

  it("refuses an option that is in no list", async () => {
    expect((await createDraft({ items: [{ kind: "nothing" }] })).json().fields).toEqual([
      { key: "items", code: "unknown_option", row: 0, column: "kind" },
    ]);
  });
});

async function optionId(value: string): Promise<string> {
  const { rows } = await sql<{ id: string }>`select id from option where option_list_id = ${LIST}::uuid and value = ${value}`.execute(migrator);
  return rows[0]!.id;
}
