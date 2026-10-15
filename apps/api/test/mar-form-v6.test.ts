// Seam 1 for the MAR Form Version 6 (RP-595, spec RP-598; form-engine.md §2.12,
// visibility.md V10): the MAR's supplier is chosen from the Project's Approved
// Supplier List, only suppliers approved for the MAR's Trade, and the MAR can't
// leave Draft without one. A withdrawn supplier is refused on a new choice and
// kept on the item that holds it; changing the Trade clears a supplier of another
// Trade. MARs on Version 5 keep their Version.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { formSchema, type ApprovedSupplier, type FormVersion } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, uploadDocument, type Caller } from "./support/harness.ts";
import { all, bilingual, detail, ok, projectMember, take, tryTake, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

let projectId = "";
let admin: Caller; // Project Admin: keeps the Approved Supplier List.
let engineer: Caller; // Raises the MARs.
let consultant: Caller; // Another Company's Member: reads the supplier's name only.
const trade = { civil: "", electrical: "" };
let buildingA = "";
const supplier = { civil: "", civilWithdrawn: "", electrical: "" };

const base = { manufacturer: "Holcim", description: "Cement", items: [{ fixture_type: "Bag", quantity: 10, unit: "pcs" }] };
const answers = (extra: Record<string, unknown> = {}) => ({ ...base, trade: trade.civil, location: buildingA, ...extra });
const create = (extra: Record<string, unknown> = {}) =>
  engineer.post(`/v1/projects/${projectId}/work-items`, { type: "MAR", title: "Cement", answers: answers(extra) });
const created = async (extra: Record<string, unknown> = {}) => (await ok(create(extra), 201)).json().id as string;
const save = (id: string, extra: Record<string, unknown>) => engineer.request("PUT", `/v1/work-items/${id}/answers`, { answers: answers(extra) });
const datasheet = (id: string) =>
  uploadDocument(engineer, id, { fieldKey: "datasheet", fileName: "datasheet.pdf", contentType: "application/pdf", body: "%PDF-1.7 datasheet" });
const suppliersOf = async (by: Caller): Promise<ApprovedSupplier[]> =>
  (await ok(by.get(`/v1/projects/${projectId}/approved-suppliers`), 200)).json().suppliers;

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

async function addSupplier(tradeId: string, name: string) {
  const res = await ok(admin.post(`/v1/projects/${projectId}/approved-suppliers`, { tradeId, scopeId: null, name: bilingual(name) }), 201);
  return res.json().id as string;
}

beforeAll(async () => {
  const c1: Company = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  admin = c1.caller;
  projectId = (await api.createProject(c1.caller, { code: "MV6" })).id;
  const post = async (path: string, body: unknown) => (await ok(c1.caller.post(`/v1/projects/${projectId}/${path}`, body), 201)).json().id as string;
  trade.civil = await post("trades", { code: "CV", name: bilingual("Civil") });
  trade.electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
  const c1ParticipantId = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id as string;
  await ok(c1.caller.request("PUT", `/v1/participants/${c1ParticipantId}/visibility`, { trade: all, location: all }));
  const k1ParticipantId = await api.addParticipant(c1.caller, projectId, k1.company, "consultant");
  await ok(c1.caller.request("PUT", `/v1/participants/${k1ParticipantId}/visibility`, { trade: all, location: all }));
  engineer = await projectMember(api, c1, c1ParticipantId, ["engineer"], { name: "Hafiz Hamdan" });
  await projectMember(api, c1, c1ParticipantId, ["project_manager"], { name: "Ali Sonour" });
  consultant = await projectMember(api, k1, k1ParticipantId, ["engineer"], { name: "Ahmed bin Said" });
  supplier.civil = await addSupplier(trade.civil, "Riyadh Cement");
  supplier.civilWithdrawn = await addSupplier(trade.civil, "Old Cement Co");
  supplier.electrical = await addSupplier(trade.electrical, "Volt Supply");
  await ok(admin.post(`/v1/approved-suppliers/${supplier.civilWithdrawn}/withdraw`, {}));
});

describe("the MAR Form Version 6", () => {
  it("is the previous Version plus a required supplier field of the Approved Supplier List", async () => {
    const form: FormVersion = (await ok(engineer.get(`/v1/projects/${projectId}/work-item-types/MAR/form`), 200)).json();
    const fieldsOf = (schema: FormVersion["schema"]) => schema.sections.flatMap((s) => s.fields);
    expect(fieldsOf(form.schema).find((f) => f.key === "supplier")).toMatchObject({ type: "approved_supplier", required: true });
    expect(form.schema.sections.map((s) => s.key)).toEqual(["material", "quantities", "documents", "references", "classification"]);
    // The Version before it (5 where it was published already, as in every deployed environment: this one is then 6;
    // a fresh database numbers it 5, since 1 to 4 come from migrations) has the same fields but the supplier.
    const versions = await marVersions();
    const latest = versions.at(-1)!;
    expect(latest.version_no).toBe(form.versionNo);
    const before = formSchema.parse(versions.at(-2)!.schema);
    expect(fieldsOf(before).map((f) => f.key)).toContain("manufacturer");
    expect(fieldsOf(before).map((f) => f.key)).not.toContain("supplier");
  });
});

describe("the supplier of a MAR (seam 1 acceptance)", () => {
  it("takes an approved supplier of the MAR's Trade, and reads back its id for the list to name", async () => {
    const id = await created({ supplier: supplier.civil });
    const item = await detail(engineer, id);
    expect(item.answers.supplier).toBe(supplier.civil);
    expect((await suppliersOf(engineer)).find((s) => s.id === supplier.civil)?.name.en).toBe("Riyadh Cement");
  });

  it("refuses another Trade's supplier, a withdrawn one and a made-up id on save, field by field", async () => {
    for (const bad of [supplier.electrical, supplier.civilWithdrawn, "00000000-0000-4000-8000-0000000000ff"]) {
      const res = await create({ supplier: bad });
      expect(res.statusCode, res.body).toBe(422);
      expect(res.json()).toMatchObject({ error: "invalid_answers", fields: [{ key: "supplier", code: "unknown_option" }] });
    }
    const id = await created();
    const res = await save(id, { supplier: supplier.electrical });
    expect(res.statusCode, res.body).toBe(422);
  });

  it("can't leave Draft without one, and leaves with one", async () => {
    const id = await created();
    await datasheet(id);
    const refused = await tryTake(engineer, id, "send_for_review");
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json()).toMatchObject({ error: "form_incomplete", fields: [{ key: "supplier", code: "required" }] });
    await ok(save(id, { supplier: supplier.civil }));
    await take(engineer, id, "send_for_review");
  });

  it("keeps a supplier withdrawn since it was chosen, so the item leaves Draft with it", async () => {
    const other = await addSupplier(trade.civil, "Soon Gone Cement");
    const id = await created({ supplier: other });
    await ok(admin.post(`/v1/approved-suppliers/${other}/withdraw`, {}));
    await ok(save(id, { supplier: other, description: "Cement, grade 42.5" }));
    expect((await detail(engineer, id)).answers.supplier).toBe(other);
    await datasheet(id);
    await take(engineer, id, "send_for_review");
    // Another Company reads the answer as the id the list names: never what approved it (V10).
    const names = await suppliersOf(consultant);
    expect(names.find((s) => s.id === other)).toEqual({ id: other, name: bilingual("Soon Gone Cement"), tradeId: trade.civil, scopeId: null, status: "withdrawn" });
  });

  it("clears the supplier when the Trade changes to another's", async () => {
    const id = await created({ supplier: supplier.civil });
    await ok(engineer.request("PUT", `/v1/work-items/${id}/answers`, { answers: { ...base, trade: trade.electrical, location: buildingA, supplier: supplier.civil } }));
    expect((await detail(engineer, id)).answers).not.toHaveProperty("supplier");
  });

  it("is not asked of a MAR on the Version before, which keeps its Version", async () => {
    const id = await created();
    // As migrated MARs are: created on the latest, with no answer the older Version lacks, then pinned to it.
    const previous = (await marVersions()).at(-2)!;
    await sql`update work_item set form_version_id = ${previous.id}::uuid where id = ${id}::uuid`.execute(migrator);
    await datasheet(id);
    await take(engineer, id, "send_for_review");
  });
});
