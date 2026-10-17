// Seam 1 for the WIR Form Version 2 and the link question's `accepts` (RP-82, INSP-2;
// spec RP-649; form-engine.md §2.13; visibility.md E1). A link question may say
// which items it takes: the WIR's Approved submittals takes only items closed with
// Code A or B, so its Link search offers those and nothing else, and a save naming
// another is refused like an unknown option. A link question without `accepts`
// still offers any Submitted item. Requested for is a plain date and time the WIR
// can't leave Draft without; nothing compares it with today. A Project Admin can make
// Approved submittals required on their Project (Project Settings → Required links):
// then a WIR there can't leave Draft without one.
//
// The submittals are a test-only Type on the test Workflow with Code B
// (addSendBackType), closed by K1's manager at A, B or C.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { formSchema, publishProblems, type FormVersion, type LinkSearchResults, type ProjectRequiredFields } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { bilingual, buildTower, detail, ok, take, tryTake, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const SUBMITTAL = "LKACC";
const classification = {
  key: "classification",
  title: bilingual("Classification"),
  fields: [
    { key: "trade", type: "trade", label: bilingual("Trade") },
    { key: "location", type: "location", label: bilingual("Location") },
    { key: "scopes", type: "scopes", label: bilingual("Scopes") },
  ],
};

let c1: Company;
let k1: Company;
let tower: Tower;
const item = { a: "", b: "", c: "", open: "" };
const requestedFor = "2026-11-02T05:30:00.000Z";

/** A submittal of C1's, Submitted to K1: K1's manager holds its Code. */
async function submittal(title: string): Promise<string> {
  const res = await ok(
    tower.c1Engineer.post(`/v1/projects/${tower.projectId}/work-items`, {
      type: SUBMITTAL,
      title,
      answers: { model: title, trade: tower.electrical, location: tower.buildingA },
    }),
    201,
  );
  const id = res.json().id as string;
  await take(tower.c1Engineer, id, "send_for_review");
  await ok(tower.c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(tower.c1Pm, id, "submit");
  await ok(tower.k1Manager.post(`/v1/work-items/${id}/pick-up`));
  await take(tower.k1Manager, id, "send_to_manager");
  return id;
}

/** A submittal closed by K1's manager with the Transition `code` (approve_a, approve_b or revise_c). */
async function closedWith(title: string, code: string): Promise<string> {
  const id = await submittal(title);
  await ok(tower.k1Manager.post(`/v1/work-items/${id}/pick-up`));
  await take(tower.k1Manager, id, code);
  return id;
}

/** The answers of a WIR on Version 2, in Building A, Electrical. */
const wirAnswers = (extra: Record<string, unknown> = {}) => ({
  description: "Cable trays on level 3, ready to close the ceiling",
  requested_for: requestedFor,
  trade: tower.electrical,
  location: tower.buildingA,
  ...extra,
});
const createWir = (extra: Record<string, unknown> = {}) =>
  tower.c1Engineer.post(`/v1/projects/${tower.projectId}/work-items`, { type: "WIR", title: "Cable trays, level 3", answers: wirAnswers(extra) });
const saveWir = (id: string, extra: Record<string, unknown>) => tower.c1Engineer.request("PUT", `/v1/work-items/${id}/answers`, { answers: wirAnswers(extra) });

async function search(by: Caller, q: string, extra: Record<string, string> = {}): Promise<string[]> {
  const res = await by.get(`/v1/projects/${tower.projectId}/work-items/link-search?${new URLSearchParams({ q, ...extra }).toString()}`);
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as LinkSearchResults).links.map((l) => l.id);
}

/** The WIR Form's published Versions, oldest first, as stored. */
async function wirVersions() {
  const { rows } = await sql<{ version_no: number; schema: unknown }>`
    select v.version_no, v.schema from form_version v
    join work_item_type t on t.form_definition_id = v.form_definition_id
    where t.owner_kind = 'rabaed' and t.code = 'WIR' and v.status = 'published'
    order by v.version_no
  `.execute(migrator);
  return rows;
}

beforeAll(async () => {
  const exists = await migrator.selectFrom("work_item_type").select("id").where("owner_kind", "=", "rabaed").where("code", "=", SUBMITTAL).executeTakeFirst();
  if (!exists) {
    await addSendBackType(
      migrator,
      SUBMITTAL,
      { en: "Link accepts submittal", ar: "اعتماد للربط" },
      { sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }, classification] },
      { withApproveB: true },
    );
  }
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  tower = await buildTower(api, { c1, k1 }, "WV2");
  item.a = await closedWith("Cable trays, Code A", "approve_a");
  item.b = await closedWith("Cable ladders, Code B", "approve_b");
  item.c = await closedWith("Cable glands, Code C", "revise_c");
  item.open = await submittal("Cable ties, under review");
});

describe("the WIR Form Version 2 (`pnpm defaults:publish`)", () => {
  // Version 2 wherever Version 1 was published (every deployed environment); a database seeded fresh, as
  // this one, publishes the document once, as Version 1.
  it("is the WIR's latest Version: Version 1 plus Requested for and the References section, and passes the publish checks against it", async () => {
    const latest = formSchema.parse((await wirVersions()).at(-1)!.schema);
    // Version 1 (RP-437): the same, less Requested for and the References section.
    const v1 = {
      sections: latest.sections
        .filter((s) => s.key !== "references")
        .map((s) => ({ ...s, fields: s.fields.filter((f) => f.key !== "requested_for") })),
    };
    expect(latest.sections.map((s) => s.key)).toEqual(["inspection", "documents", "references", "classification"]);
    expect(latest.sections[0]!.fields.map((f) => f.key)).toEqual(["description", "specification_section", "requested_for"]);
    expect(latest.sections[0]!.fields[2]).toMatchObject({ type: "datetime", required: true, label: { en: "Requested for" } });
    expect(latest.sections[2]!.fields).toEqual([
      expect.objectContaining({ key: "approved_submittals", type: "work_item_ref", required: false, accepts: { outcomes: ["A", "B"] } }),
    ]);
    expect(v1.sections.flatMap((s) => s.fields.map((f) => f.key))).toEqual([
      "description", "specification_section", "attachments", "photos", "trade", "location", "scopes",
    ]);
    const types = new Map([
      ["MAR", new Set(["A", "B", "C", "D"])],
      ["WIR", new Set(["passed", "passed_with_comments", "failed"])],
    ]);
    expect(publishProblems(latest, [v1], { types })).toEqual([]);
  });

  it("is the Form a new WIR gets", async () => {
    const form: FormVersion = (await ok(tower.c1Engineer.get(`/v1/projects/${tower.projectId}/work-item-types/WIR/form`), 200)).json();
    expect(form.versionNo).toBe((await wirVersions()).at(-1)!.version_no);
  });
});

describe("Link search with a link question's `accepts`", () => {
  it("offers only items closed with one of its outcomes: the A and the B, never the C or one still open", async () => {
    expect(new Set(await search(tower.c1Engineer, "Cable", { outcomes: "A,B" }))).toEqual(new Set([item.a, item.b]));
    expect(await search(tower.c1Engineer, "Cable", { outcomes: "C" })).toEqual([item.c]);
  });

  it("offers only items of its Types, open or closed, with outcomes too only those closed with one", async () => {
    expect(new Set(await search(tower.c1Engineer, "Cable", { types: SUBMITTAL }))).toEqual(new Set([item.a, item.b, item.c, item.open]));
    expect(await search(tower.c1Engineer, "Cable", { types: "WIR" })).toEqual([]);
    expect(await search(tower.c1Engineer, "Cable", { types: SUBMITTAL, outcomes: "A" })).toEqual([item.a]);
  });

  it("offers any Submitted item without it (a free Link, or a link question without `accepts`)", async () => {
    expect(new Set(await search(tower.c1Engineer, "Cable"))).toEqual(new Set([item.a, item.b, item.c, item.open]));
  });

  it("refuses a Type or outcome that isn't one", async () => {
    for (const extra of [{ types: "mar" }, { outcomes: "1A" }] as Record<string, string>[]) {
      const res = await tower.c1Engineer.get(`/v1/projects/${tower.projectId}/work-items/link-search?${new URLSearchParams({ q: "Cable", ...extra }).toString()}`);
      expect(res.statusCode).toBe(400);
    }
  });
});

describe("a WIR's Approved submittals", () => {
  it("takes the A and the B, and refuses the C or one still open like an unknown option", async () => {
    const id = (await ok(createWir({ approved_submittals: [item.a, item.b] }), 201)).json().id as string;
    expect((await detail(tower.c1Engineer, id)).answers).toMatchObject({ approved_submittals: [item.a, item.b] });
    for (const other of [item.c, item.open]) {
      const res = await saveWir(id, { approved_submittals: [item.a, other] });
      expect({ status: res.statusCode, body: res.json() }).toEqual({
        status: 422,
        body: { error: "invalid_answers", fields: [{ key: "approved_submittals", code: "unknown_option" }] },
      });
    }
    const created = await createWir({ approved_submittals: [item.c] });
    expect(created.statusCode).toBe(422);
    expect(created.json().fields).toEqual([{ key: "approved_submittals", code: "unknown_option" }]);
  });

  it("is optional: a WIR without one is sent for review", async () => {
    const id = (await ok(createWir(), 201)).json().id as string;
    await take(tower.c1Engineer, id, "send_for_review");
  });
});

describe("Project Settings → Required links: \"Approved submittals required\"", () => {
  const settings = async (by: Caller): Promise<ProjectRequiredFields> =>
    (await ok(by.get(`/v1/projects/${tower.projectId}/required-fields`), 200)).json();
  const set = (by: Caller, body: Record<string, unknown>) => by.request("PUT", `/v1/projects/${tower.projectId}/required-fields`, body);
  const approvedSubmittals = (s: ProjectRequiredFields) => s.fields.find((f) => f.type === "WIR" && f.key === "approved_submittals");
  const sendForReview = async (extra: Record<string, unknown> = {}) => {
    const id = (await ok(createWir(extra), 201)).json().id as string;
    return tryTake(tower.c1Engineer, id, "send_for_review");
  };

  it("lists every link question of the Project's Types, off until a Project Admin turns it on; every Project Member reads it", async () => {
    const forEngineer = await settings(tower.c1Engineer);
    expect(forEngineer.canEdit).toBe(false);
    expect(approvedSubmittals(forEngineer)).toEqual({
      type: "WIR",
      typeName: { en: "Work Inspection Request", ar: "طلب معاينة أعمال" },
      key: "approved_submittals",
      label: { en: "Approved submittals", ar: "الاعتمادات الموافق عليها" },
      requiredByForm: false,
      required: false,
    });
    expect(forEngineer.fields.map((f) => [f.type, f.key])).toContainEqual(["MAR", "related_submittals"]);
    expect((await settings(tower.k1Manager)).fields).toEqual(forEngineer.fields);
    expect((await settings(tower.admin!)).canEdit).toBe(true);
  });

  it("is changed by a Project Admin only: anyone else is told it isn't there", async () => {
    for (const by of [tower.c1Engineer, tower.k1Manager]) {
      const res = await set(by, { type: "WIR", key: "approved_submittals", required: true });
      expect(res.statusCode).toBe(404);
    }
    expect(approvedSubmittals(await settings(tower.c1Engineer))!.required).toBe(false);
  });

  it("names only a link question of a Type's Form", async () => {
    for (const [body, error] of [
      [{ type: "WIR", key: "description", required: true }, "field_not_found"],
      [{ type: "WIR", key: "made_up", required: true }, "field_not_found"],
      [{ type: "ZZZ", key: "approved_submittals", required: true }, "type_not_found"],
    ] as const) {
      const res = await set(tower.admin!, body);
      expect({ status: res.statusCode, error: res.json().error }).toEqual({ status: 422, error });
    }
  });

  it("on, a WIR without an approved submittal can't be sent for review, naming the field; with one, or off, it can", async () => {
    await ok(set(tower.admin!, { type: "WIR", key: "approved_submittals", required: true }));
    expect(approvedSubmittals(await settings(tower.c1Engineer))!.required).toBe(true);
    // The Form a new WIR gets says so, for the asterisk.
    const form: FormVersion = (await ok(tower.c1Engineer.get(`/v1/projects/${tower.projectId}/work-item-types/WIR/form`), 200)).json();
    expect(form.schema.sections.flatMap((s) => s.fields).find((f) => f.key === "approved_submittals")).toMatchObject({ required: true });

    const refused = await sendForReview();
    expect({ status: refused.statusCode, body: refused.json() }).toEqual({
      status: 422,
      body: { error: "form_incomplete", fields: [{ key: "approved_submittals", code: "required" }] },
    });
    // A Draft still saves without one.
    expect((await createWir()).statusCode).toBe(201);
    expect((await sendForReview({ approved_submittals: [item.a] })).statusCode).toBe(204);

    await ok(set(tower.admin!, { type: "WIR", key: "approved_submittals", required: false }));
    expect((await sendForReview()).statusCode).toBe(204);
  });

  it("is the Project's own: another Project's WIRs are as the Form says", async () => {
    await ok(set(tower.admin!, { type: "WIR", key: "approved_submittals", required: true }));
    const other = await buildTower(api, { c1, k1 }, "WV3");
    const id = (
      await ok(
        other.c1Engineer.post(`/v1/projects/${other.projectId}/work-items`, {
          type: "WIR",
          title: "Cable trays, elsewhere",
          answers: { description: "Trays", requested_for: requestedFor, trade: other.electrical, location: other.buildingA },
        }),
        201,
      )
    ).json().id as string;
    expect((await tryTake(other.c1Engineer, id, "send_for_review")).statusCode).toBe(204);
    await ok(set(tower.admin!, { type: "WIR", key: "approved_submittals", required: false }));
  });
});

describe("Requested for", () => {
  it("is a date and time the WIR can't leave Draft without, kept as given", async () => {
    const id = (await ok(createWir({ requested_for: undefined }), 201)).json().id as string;
    const refused = await tryTake(tower.c1Engineer, id, "send_for_review");
    expect({ status: refused.statusCode, body: refused.json() }).toEqual({
      status: 422,
      body: { error: "form_incomplete", fields: [{ key: "requested_for", code: "required" }] },
    });
    await ok(saveWir(id, {}));
    expect((await detail(tower.c1Engineer, id)).answers).toMatchObject({ requested_for: requestedFor });
    await take(tower.c1Engineer, id, "send_for_review");
  });

  it("takes only an instant, as for any date-time field", async () => {
    const res = await createWir({ requested_for: "next Tuesday" });
    expect(res.statusCode).toBe(422);
    expect(res.json().fields).toEqual([{ key: "requested_for", code: "invalid_format" }]);
  });
});
