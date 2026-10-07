// Seam 1 for the MAR Form Version 3 (RP-294, spec RP-289; form-engine.md §2.10):
// Version 2 plus an optional "Related submittals" link question
// (`work_item_ref`). New MARs pin Version 3, and an item picked there is a
// Link of the MAR under the question's key. MARs already on Version 1 or 2 keep
// showing and validating with theirs. Version 3 passes the part-1 publish
// checks against Versions 1 and 2.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { formSchema, publishProblems, type WorkItemLinks } from "@rabaed/domain";
import { sql } from "kysely";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, type Caller } from "./support/harness.ts";
import { detail, projectMember, tryTake } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const bilingual = (text: string) => ({ en: text, ar: text });
const all = { isAll: true, valueIds: [] };

let engineer: Caller;
let pm: Caller;
let projectId = "";
let electrical = "";
let buildingA = "";

async function ok(res: Promise<LightMyRequestResponse>, status = 204) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
  return r;
}

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

const complete = {
  manufacturer: "Philips",
  description: "LED fixtures",
  items: [{ fixture_type: "Downlight", quantity: 120, unit: "pcs" }],
};
const created = async (title: string, answers: Record<string, unknown> = {}) =>
  (
    await ok(
      engineer.post(`/v1/projects/${projectId}/work-items`, {
        type: "MAR",
        title,
        answers: { ...complete, trade: electrical, location: buildingA, ...answers },
      }),
      201,
    )
  ).json().id as string;
const save = (id: string, answers: Record<string, unknown>) =>
  engineer.request("PUT", `/v1/work-items/${id}/answers`, { answers: { trade: electrical, location: buildingA, ...answers } });
const links = async (id: string): Promise<WorkItemLinks> => (await ok(engineer.get(`/v1/work-items/${id}/links`), 200)).json();
const pin = async (id: string, versionNo: number) => {
  const version = (await marVersions()).find((v) => v.version_no === versionNo)!;
  await sql`update work_item set form_version_id = ${version.id}::uuid where id = ${id}::uuid`.execute(migrator);
};

/** A MAR sent by the engineer and Submitted by the PM: one that can be linked. */
async function submitted(title: string): Promise<string> {
  const id = await created(title);
  await attachDatasheet(engineer, id);
  await ok(tryTake(engineer, id, "send_for_review"));
  await ok(pm.post(`/v1/work-items/${id}/claim`));
  await ok(tryTake(pm, id, "submit"));
  return id;
}

beforeAll(async () => {
  const c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  electrical = (await c1.caller.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") })).json().id;
  buildingA = (await c1.caller.post(`/v1/projects/${projectId}/locations`, { code: "BA", name: bilingual("Building A"), parentId: null }))
    .json().id;
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  // A Consultant, whom Submit sends the MAR to.
  const k1 = await api.onboardCompany({ legalName: bilingual("Design Consultants LLC") });
  const k1Caller = await api.acceptInvitation(k1.invitationToken);
  const k1Participant = await api.addParticipant(c1.caller, projectId, k1, "consultant");
  await ok(c1.caller.request("PUT", `/v1/participants/${k1Participant}/visibility`, { trade: all, location: all }));
  engineer = await projectMember(api, c1, own, ["engineer"]);
  pm = await projectMember(api, c1, own, ["project_manager"]);
  // Holds the Consultant Step that Submit leads to.
  await projectMember(api, { caller: k1Caller }, k1Participant, ["manager"]);
});

describe("the MAR Form Version 3", () => {
  it("is the MAR's latest Version, and passes the part-1 publish checks against Versions 1 and 2", async () => {
    const versions = await marVersions();
    expect(versions.map((v) => v.version_no).slice(0, 3)).toEqual([1, 2, 3]);
    const [v1, v2, v3] = versions.slice(0, 3).map((v) => formSchema.parse(v.schema));
    const { rows: lists } = await sql<{ id: string }>`select id from option_list`.execute(migrator);
    expect(publishProblems(v3!, [v1!, v2!], { optionListIds: new Set(lists.map((l) => l.id)) })).toEqual([]);
  });

  it("is Version 2 plus an optional Related submittals link question, labelled in English and Arabic", async () => {
    // Version 4 (RP-306) is the latest now: Version 3 is read as stored.
    const form = { schema: formSchema.parse((await marVersions())[2]!.schema) };
    const fields = form.schema.sections.flatMap((s) => s.fields);
    expect(fields.map((f) => f.key)).toEqual([
      "manufacturer",
      "model",
      "specification_section",
      "description",
      "items",
      "datasheet",
      "test_certificate",
      "sample_photo",
      "related_submittals",
      "trade",
      "location",
      "scopes",
    ]);
    expect(fields.find((f) => f.key === "related_submittals")).toMatchObject({
      type: "work_item_ref",
      required: false,
      label: { en: "Related submittals", ar: "الاعتمادات ذات الصلة" },
    });
    // Everything else is Version 2's, unchanged.
    const v2 = formSchema.parse((await marVersions())[1]!.schema);
    const v2Fields = v2.sections.flatMap((s) => s.fields);
    expect(fields.filter((f) => f.key !== "related_submittals")).toEqual(v2Fields);
  });
});

describe("a new MAR", () => {
  let approved = "";

  beforeAll(async () => {
    approved = await submitted("Cable trays, submitted");
  });

  it("pins the latest Version (4 since RP-306, Version 3 plus the Consultant verification), and leaves Draft without Related submittals", async () => {
    const latest = (await marVersions()).at(-1)!;
    const id = await created("Lighting fixtures");
    expect((await detail(engineer, id)).formVersionId).toBe(latest.id);
    await attachDatasheet(engineer, id);
    await ok(tryTake(engineer, id, "send_for_review"));
    expect((await detail(engineer, id)).stage.key).not.toBe("draft");
  });

  it("keeps a Submitted MAR picked under Related submittals, as a Link under that question", async () => {
    const id = await created("Cable tray brackets", { related_submittals: [approved] });
    expect((await detail(engineer, id)).answers).toMatchObject({ related_submittals: [approved] });
    expect((await links(id)).links).toMatchObject([
      { kind: "relies_on", fieldKey: "related_submittals", subject: "Cable trays, submitted", workItemId: approved },
    ]);
  });
});

describe("a MAR on an earlier Version", () => {
  it("keeps Version 2: it shows Version 2, has no Related submittals, and leaves Draft with Version 2's rules", async () => {
    const id = await created("Lighting fixtures, Version 2");
    await pin(id, 2);
    expect((await ok(engineer.get(`/v1/work-items/${id}/form`), 200)).json().versionNo).toBe(2);
    const refused = await save(id, { ...complete, related_submittals: [] });
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toEqual({ error: "invalid_answers", fields: [{ key: "related_submittals", code: "unknown_field" }] });
    // Version 2's required Datasheet still blocks leaving Draft.
    const incomplete = await tryTake(engineer, id, "send_for_review");
    expect(incomplete.json()).toEqual({ error: "form_incomplete", fields: [{ key: "datasheet", code: "required" }] });
    await attachDatasheet(engineer, id);
    await ok(tryTake(engineer, id, "send_for_review"));
  });

  it("keeps Version 1: it shows Version 1 and leaves Draft without a Datasheet", async () => {
    const id = await created("Emergency luminaires, Version 1", { items: undefined });
    await pin(id, 1);
    expect((await ok(engineer.get(`/v1/work-items/${id}/form`), 200)).json().versionNo).toBe(1);
    const v1Answers = { manufacturer: "Zumtobel", quantity: 48, description: "Emergency luminaires" };
    await ok(save(id, v1Answers));
    await ok(tryTake(engineer, id, "send_for_review"));
    expect((await detail(engineer, id)).answers).toMatchObject(v1Answers);
  });
});
