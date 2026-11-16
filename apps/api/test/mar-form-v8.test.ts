// Seam 1 for the MAR Form Version 8 (RP-1298, owner's decisions 2026-11-16; form-engine.md §2.12b):
// an Item's Quantity is optional, since many MARs are raised before it is known, and its Unit is
// required only in a row that has a Quantity. A MAR on Version 7 keeps its Version, and so its rule:
// Quantity and Unit stay required there (ADR 0006).
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { formSchema, type FormVersion, type TableField } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, uploadDocument, type Caller } from "./support/harness.ts";
import { all, bilingual, ok, projectMember, take, tryTake, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

let projectId = "";
let engineer: Caller;
let trade = "";
let location = "";
let supplier = "";

const create = async (items: Record<string, unknown>[]) => {
  const answers = { trade, location, supplier, manufacturer: "Philips", description: "Panel lights", items };
  const id = (await ok(engineer.post(`/v1/projects/${projectId}/work-items`, { type: "MAR", title: "Panel lights", answers }), 201)).json().id as string;
  await uploadDocument(engineer, id, { fieldKey: "datasheet", fileName: "datasheet.pdf", contentType: "application/pdf", body: "%PDF-1.7 datasheet" });
  return id;
};

/** The MAR Form's published Versions, oldest first, as stored. */
async function marVersions() {
  const { rows } = await sql<{ id: string; version_no: number; schema: unknown }>`
    select v.id, v.version_no, v.schema from form_version v
    join work_item_type t on t.form_definition_id = v.form_definition_id
    where t.owner_kind = 'rabaed' and t.code = 'MAR' and v.status = 'published'
    order by v.version_no
  `.execute(migrator);
  return rows;
}

const itemsOf = (schema: FormVersion["schema"]) =>
  schema.sections.flatMap((s) => s.fields).find((f): f is TableField => f.key === "items" && f.type === "table")!;
const column = (schema: FormVersion["schema"], key: string) => itemsOf(schema).columns.find((c) => c.key === key);

beforeAll(async () => {
  const c1: Company = await api.projectCreator();
  projectId = (await api.createProject(c1.caller, { code: "MV8" })).id;
  const post = async (path: string, body: unknown) => (await ok(c1.caller.post(`/v1/projects/${projectId}/${path}`, body), 201)).json().id as string;
  trade = await post("trades", { code: "EL", name: bilingual("Electrical") });
  location = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
  supplier = await post("approved-suppliers", { tradeId: trade, scopeId: null, name: bilingual("Najd Electrical Supplies") });
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id as string;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  engineer = await projectMember(api, c1, own, ["engineer"]);
  await projectMember(api, c1, own, ["project_manager"]);
});

describe("the MAR Form Version 8", () => {
  it("makes the Items' Quantity optional, still totalled, and their Unit required only with a Quantity", async () => {
    const form: FormVersion = (await ok(engineer.get(`/v1/projects/${projectId}/work-item-types/MAR/form`), 200)).json();
    expect(column(form.schema, "quantity")).toMatchObject({ type: "number", total: true, required: false });
    expect(column(form.schema, "unit")).toMatchObject({ type: "select", required: { field: "quantity", op: "not_empty" } });
    // Every other column, field and section keeps Version 7's key and required flag.
    expect(itemsOf(form.schema).columns.map((c) => c.key)).toEqual(["fixture_type", "description", "quantity", "unit"]);
    expect(column(form.schema, "fixture_type")).toMatchObject({ required: true });
    expect(form.schema.sections.map((s) => s.key)).toEqual(["classification", "material", "quantities", "documents", "references"]);
    // The Version before it (7 wherever Version 7 was published) required both.
    const versions = await marVersions();
    expect(versions.at(-1)!.version_no).toBe(form.versionNo);
    const before = formSchema.parse(versions.at(-2)!.schema);
    expect(column(before, "quantity")).toMatchObject({ required: true });
    expect(column(before, "unit")).toMatchObject({ required: true });
  });
});

describe("an Item's Quantity on a MAR (seam 1 acceptance)", () => {
  it("may be left empty: the MAR is sent for Review with an Item that has no Quantity and no Unit", async () => {
    const id = await create([{ fixture_type: "Recessed panel", quantity: 200, unit: "pcs" }, { fixture_type: "Emergency exit sign" }]);
    await take(engineer, id, "send_for_review");
  });

  it("still asks for the Unit of a row that has a Quantity", async () => {
    const id = await create([{ fixture_type: "Recessed panel", quantity: 200 }]);
    const refused = await tryTake(engineer, id, "send_for_review");
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json()).toMatchObject({ error: "form_incomplete", fields: [{ key: "items", code: "required", row: 0, column: "unit" }] });
  });

  it("is still required on a MAR on Version 7, which keeps its Version", async () => {
    const id = await create([{ fixture_type: "Emergency exit sign" }]);
    // As a Draft raised before Version 8 is: pinned to the Version before.
    const previous = (await marVersions()).at(-2)!;
    await sql`update work_item set form_version_id = ${previous.id}::uuid where id = ${id}::uuid`.execute(migrator);
    const refused = await tryTake(engineer, id, "send_for_review");
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json()).toMatchObject({
      error: "form_incomplete",
      fields: [
        { key: "items", code: "required", row: 0, column: "quantity" },
        { key: "items", code: "required", row: 0, column: "unit" },
      ],
    });
  });
});
