// Seam 1 for Project Checklist Templates and the WIR's Checklist Template choice (RP-651,
// INSP-3; spec RP-649; form-engine.md §3.2; visibility.md V20). A Project Admin keeps the
// Project's templates in Project Settings: each edit is a new Version, and a retired one is
// offered to no new pick. The WIR Form Version 3 asks the raiser for one of the active
// templates of the WIR's Trade, and the picked Version's items are copied onto the WIR: a
// later edit or retirement never changes the copy, a new pick before the first Submit
// replaces it, and after the first Submit the pick and the copy are fixed, even where a
// Send Back lets the raiser edit the Form.
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import { formSchema, publishProblems, type ChecklistTemplates, type FormVersion } from "@rabaed/domain";
import { rabaedFormFile } from "@rabaed/admin/services";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { passChecklists } from "./support/checklist-template.ts";
import { createTestApi, expectHidden, readById, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { bilingual, buildTower, detail, ok, projectMember, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const check = (key: string, en: string, extra: Record<string, unknown> = {}) => ({ key, text: { en, ar: `${en} (ع)` }, ...extra });
const pourItems = [
  check("formwork", "Formwork level and tight"),
  check("rebar_cover", "Rebar cover as per drawing", { comment: "required_on_negative", photo: "required_on_negative" }),
  check("cubes", "Cube samples taken", { answers: "yes_no_na", on_negative: "none" }),
];
const pour = (tradeId: string, items: unknown[] = pourItems) => ({ name: { en: "Concrete pour", ar: "صب الخرسانة" }, tradeId, items });

let c1: Company;
let k1: Company;
let tower: Tower;
let admin: Caller;
let k1Engineer: Caller;
let civil = "";
const requestedFor = "2026-11-02T05:30:00.000Z";

const templates = async (by: Caller, projectId = tower.projectId): Promise<ChecklistTemplates> =>
  (await ok(by.get(`/v1/projects/${projectId}/checklist-templates`), 200)).json();
const createTemplate = async (body: unknown): Promise<string> =>
  (await ok(admin.post(`/v1/projects/${tower.projectId}/checklist-templates`, body), 201)).json().id as string;
/** The template `id`'s latest Version, as a pick names it. */
const latestVersion = async (id: string) => (await templates(admin)).templates.find((t) => t.id === id)!.versionId;

/** The answers of a WIR on Version 3, in Building A. */
const wirAnswers = (trade: string, extra: Record<string, unknown> = {}) => ({
  description: "Slab pour, level 2",
  requested_for: requestedFor,
  trade,
  location: tower.buildingA,
  ...extra,
});
const createWir = (trade: string, extra: Record<string, unknown>) =>
  tower.c1Engineer.post(`/v1/projects/${tower.projectId}/work-items`, { type: "WIR", title: "Slab pour, level 2", answers: wirAnswers(trade, extra) });
const saveWir = (id: string, trade: string, extra: Record<string, unknown>) =>
  tower.c1Engineer.request("PUT", `/v1/work-items/${id}/answers`, { answers: wirAnswers(trade, extra) });

beforeAll(async () => {
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  tower = await buildTower(api, { c1, k1 }, "CKT");
  admin = tower.admin!;
  civil = (await ok(admin.post(`/v1/projects/${tower.projectId}/trades`, { code: "CV", name: bilingual("Civil") }), 201)).json().id as string;
  // K1's engineer holds the Consultant Engineer Step a Submit leads to.
  const k1ParticipantId = (await tower.k1Manager.get(`/v1/projects/${tower.projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id as string;
  k1Engineer = await projectMember(api, k1, k1ParticipantId, ["engineer"]);
});

describe("the WIR Form Version 3 (`pnpm defaults:publish`)", () => {
  it("is the document a new WIR gets: Version 2 plus the Checklist section and its required Checklist Template choice", async () => {
    const file = formSchema.parse(rabaedFormFile("WIR.json"));
    const form: FormVersion = (await ok(tower.c1Engineer.get(`/v1/projects/${tower.projectId}/work-item-types/WIR/form`), 200)).json();
    expect(form.schema).toEqual(file);
    const checklist = file.sections.find((s) => s.key === "checklist");
    expect(checklist?.fields).toEqual([expect.objectContaining({ key: "checklist_template", type: "checklist_template", required: true })]);
    // The raiser's own section: no Steps of another Participant.
    expect(checklist?.editable_at).toBeUndefined();
    expect(publishProblems(file)).toEqual([]);
  });
});

describe("a Project's Checklist Templates", () => {
  it("a Project Admin creates one, Version 1, each item raising a Snag on a negative answer unless it says none", async () => {
    const id = await createTemplate(pour(civil));
    const listed = (await templates(admin)).templates.find((t) => t.id === id)!;
    expect(listed).toMatchObject({ versionNo: 1, name: { en: "Concrete pour" }, tradeId: civil, status: "active" });
    expect(listed.items.map((i) => [i.key, i.answers, i.comment, i.photo, i.on_negative])).toEqual([
      ["formwork", "pass_fail_na", "optional", "off", "create_snag"],
      ["rebar_cover", "pass_fail_na", "required_on_negative", "required_on_negative", "create_snag"],
      ["cubes", "yes_no_na", "optional", "off", "none"],
    ]);
  });

  it("every Participant's Project Members read them; only Project Admins may change them (canEdit)", async () => {
    expect((await templates(admin)).canEdit).toBe(true);
    for (const reader of [tower.c1Engineer, tower.k1Manager]) {
      const list = await templates(reader);
      expect(list.canEdit).toBe(false);
      expect(list.templates.some((t) => t.name.en === "Concrete pour")).toBe(true);
    }
  });

  it("anyone else, and a made-up Project, get the 404", async () => {
    const stranger = await api.authorizedPerson();
    await expectHidden(stranger.caller.get(`/v1/projects/${tower.projectId}/checklist-templates`));
    await expectHidden(admin.get(`/v1/projects/${randomUUID()}/checklist-templates`));
  });

  it("refuses a Trade the Project doesn't have, a Location, no items, and repeated keys", async () => {
    const refused = async (body: unknown, status: number, error?: string) => {
      const res = await admin.post(`/v1/projects/${tower.projectId}/checklist-templates`, body);
      expect(res.statusCode, res.body).toBe(status);
      if (error) expect(res.json()).toMatchObject({ error });
    };
    await refused(pour(tower.buildingA), 422, "trade_not_found");
    await refused(pour(randomUUID()), 422, "trade_not_found");
    await refused(pour(civil, []), 400);
    await refused(pour(civil, [pourItems[0], pourItems[0]]), 400);
  });
});

describe("only a Project Admin writes a template (seam 1 of RP-651-1)", () => {
  it("a Member who isn't one, the Consultant and a stranger get the 404, as for a made-up template, and nothing changes", async () => {
    const id = await createTemplate({ ...pour(civil), name: bilingual("Blockwork") });
    const stranger = await api.authorizedPerson();
    for (const by of [tower.c1Engineer, tower.c1Pm, tower.k1Manager, stranger.caller]) {
      await expectHidden(by.post(`/v1/projects/${tower.projectId}/checklist-templates`, pour(civil)));
      await expectHidden(by.request("PUT", `/v1/checklist-templates/${id}`, pour(civil)));
      await expectHidden(by.post(`/v1/checklist-templates/${id}/retire`));
    }
    await expectHidden(admin.request("PUT", `/v1/checklist-templates/${randomUUID()}`, pour(civil)));
    await expectHidden(admin.post(`/v1/checklist-templates/${randomUUID()}/retire`));
    expect((await templates(admin)).templates.find((t) => t.id === id)).toMatchObject({ versionNo: 1, status: "active", name: bilingual("Blockwork") });
  });

  it("edits are Versions, a retired one takes none, and each command is audited", async () => {
    const id = await createTemplate({ ...pour(civil), name: bilingual("Screed") });
    await ok(admin.request("PUT", `/v1/checklist-templates/${id}`, { ...pour(civil), name: bilingual("Screed, levelled") }));
    expect((await templates(admin)).templates.find((t) => t.id === id)).toMatchObject({ versionNo: 2, name: bilingual("Screed, levelled") });
    await ok(admin.post(`/v1/checklist-templates/${id}/retire`));
    // Retiring again is no change.
    await ok(admin.post(`/v1/checklist-templates/${id}/retire`));
    expect((await templates(admin)).templates.find((t) => t.id === id)).toMatchObject({ versionNo: 2, status: "retired" });
    const edit = await admin.request("PUT", `/v1/checklist-templates/${id}`, pour(civil));
    expect(edit.statusCode, edit.body).toBe(409);
    expect(edit.json()).toMatchObject({ error: "template_retired" });
    const audited = await migrator
      .selectFrom("setup_event")
      .select(["kind", "type"])
      .where("project_id", "=", tower.projectId)
      .where(({ eb, ref }) => eb(eb.fn<string>("jsonb_extract_path_text", [ref("payload"), eb.val("checklist_template_id")]), "=", id))
      .orderBy("created_at")
      .orderBy("id")
      .execute();
    expect(audited).toEqual([
      { kind: "checklist_template", type: "checklist_template_created" },
      { kind: "checklist_template", type: "checklist_template_edited" },
      { kind: "checklist_template", type: "checklist_template_retired" },
    ]);
  });
});

describe("a WIR's Checklist Template (seam 1 acceptance)", () => {
  let template = "";
  let v1 = "";
  beforeAll(async () => {
    template = await createTemplate({ ...pour(civil), name: { en: "Concrete pour, slabs", ar: "صب البلاطات" } });
    v1 = await latestVersion(template);
  });

  it("a Civil WIR is offered it, and picking it copies its items onto the WIR; an Electrical WIR is not", async () => {
    const id = (await ok(createWir(civil, { checklist_template: v1 }), 201)).json().id as string;
    const item = await detail(tower.c1Engineer, id);
    expect(item.answers.checklist_template).toBe(v1);
    expect(item.checklistCopies).toEqual([
      expect.objectContaining({ fieldKey: "checklist_template", templateId: template, versionId: v1, versionNo: 1, tradeId: civil, name: { en: "Concrete pour, slabs", ar: "صب البلاطات" } }),
    ]);
    expect(item.checklistCopies[0]!.items.map((i) => i.key)).toEqual(["formwork", "rebar_cover", "cubes"]);
    const electrical = await createWir(tower.electrical, { checklist_template: v1 });
    expect(electrical.statusCode, electrical.body).toBe(422);
    expect(electrical.json()).toMatchObject({ error: "invalid_answers", fields: [{ key: "checklist_template", code: "unknown_option" }] });
  });

  it("is required to send the WIR for review, naming the field; a Draft saves without one", async () => {
    const id = (await ok(createWir(civil, {}), 201)).json().id as string;
    expect((await detail(tower.c1Engineer, id)).checklistCopies).toEqual([]);
    const res = await tower.c1Engineer.post(`/v1/work-items/${id}/transitions`, { transition: "send_for_review", confirmed: true, idempotencyKey: randomUUID() });
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json()).toMatchObject({ error: "form_incomplete", fields: [{ key: "checklist_template", code: "required" }] });
  });

  it("editing the template afterwards doesn't change the WIR; picking its new Version before Submit replaces the copy", async () => {
    const id = (await ok(createWir(civil, { checklist_template: v1 }), 201)).json().id as string;
    await ok(admin.request("PUT", `/v1/checklist-templates/${template}`, pour(civil, [...pourItems, check("curing", "Curing compound applied")])));
    const v2 = await latestVersion(template);
    // A save keeping the pick keeps the copy, the edited template's Version 1.
    await ok(saveWir(id, civil, { checklist_template: v1, description: "Slab pour, level 2, bay 3" }), 204);
    let copy = (await detail(tower.c1Engineer, id)).checklistCopies[0]!;
    expect([copy.versionId, copy.versionNo, copy.items.length]).toEqual([v1, 1, 3]);
    // Version 1 isn't offered to a new WIR any more.
    expect((await createWir(civil, { checklist_template: v1 })).statusCode).toBe(422);
    await ok(saveWir(id, civil, { checklist_template: v2 }), 204);
    copy = (await detail(tower.c1Engineer, id)).checklistCopies[0]!;
    expect([copy.versionId, copy.versionNo, copy.items.map((i) => i.key)]).toEqual([v2, 2, ["formwork", "rebar_cover", "cubes", "curing"]]);
    // Taking the pick back clears the copy; changing the Trade clears the pick, and so the copy.
    await ok(saveWir(id, civil, {}), 204);
    expect((await detail(tower.c1Engineer, id)).checklistCopies).toEqual([]);
    await ok(saveWir(id, civil, { checklist_template: v2 }), 204);
    await ok(saveWir(id, tower.electrical, { checklist_template: v2 }), 204);
    const moved = await detail(tower.c1Engineer, id);
    expect(moved.answers.checklist_template).toBeUndefined();
    expect(moved.checklistCopies).toEqual([]);
  });

  it("after Submit the pick is fixed, and the Consultant reads the copy", async () => {
    const id = (await ok(createWir(civil, { checklist_template: await latestVersion(template) }), 201)).json().id as string;
    await take(tower.c1Engineer, id, "send_for_review");
    await ok(tower.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await take(tower.c1Pm, id, "submit", { answers: { cover_note: "Ready from 09:00" } });
    const refused = await saveWir(id, civil, { checklist_template: v1 });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({ error: "not_editable" });
    const seen = await detail(tower.k1Manager, id);
    expect(seen.checklistCopies.map((c) => c.items.length)).toEqual([4]);
  });

  it("a WIR's Revision after Code C, the re-inspection (RP-673), carries its pick and its copy, that Version edited since, and is Submitted with it without a save", async () => {
    const picked = await latestVersion(template);
    const id = (await ok(createWir(civil, { checklist_template: picked }), 201)).json().id as string;
    await take(tower.c1Engineer, id, "send_for_review");
    await ok(tower.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await take(tower.c1Pm, id, "submit", { answers: { cover_note: "Ready from 09:00" } });
    await passChecklists(k1Engineer, id);
    await take(k1Engineer, id, "send_to_manager", { recommendedCode: "C" });
    await tower.k1Manager.post(`/v1/work-items/${id}/pick-up`);
    await take(tower.k1Manager, id, "revise_c", { answers: { sample_checked: true, matches_specification: false, verification_note: "Cover short" }, remarks: "Cover short at gridline 4" });
    await ok(admin.request("PUT", `/v1/checklist-templates/${template}`, pour(civil, pourItems.slice(0, 2))));
    const revision = (await ok(tower.c1Engineer.post(`/v1/work-items/${id}/revisions`, { idempotencyKey: randomUUID() }), 201)).json().id as string;
    const fresh = await detail(tower.c1Engineer, revision);
    expect(fresh.answers.checklist_template).toBe(picked);
    // Copied when the Revision is created: the revised WIR's Version, never the template's newer one.
    expect(fresh.checklistCopies.map((c) => [c.versionId, c.items.length])).toEqual([[picked, 4]]);
    // Sent on and Submitted with no save: the Consultant reads the same checklist.
    await take(tower.c1Engineer, revision, "send_for_review");
    await ok(tower.c1Pm.post(`/v1/work-items/${revision}/pick-up`));
    await take(tower.c1Pm, revision, "submit", { answers: { cover_note: "Re-inspection, cover fixed" } });
    expect((await detail(k1Engineer, revision)).checklistCopies.map((c) => [c.versionId, c.items.length])).toEqual([[picked, 4]]);
  });

  it("refuses a pick naming another Project's template Version, as an unknown option, and copies nothing", async () => {
    const other = await buildTower(api, { c1, k1 }, "CKO");
    const otherCivil = (await ok(other.admin!.post(`/v1/projects/${other.projectId}/trades`, { code: "CV", name: bilingual("Civil") }), 201)).json().id as string;
    const foreign = (await ok(other.admin!.post(`/v1/projects/${other.projectId}/checklist-templates`, pour(otherCivil)), 201)).json().id as string;
    const foreignVersion = ((await templates(other.admin!, other.projectId)).templates.find((t) => t.id === foreign))!.versionId;
    const refused = await createWir(civil, { checklist_template: foreignVersion });
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json()).toMatchObject({ error: "invalid_answers", fields: [{ key: "checklist_template", code: "unknown_option" }] });
    const id = (await ok(createWir(civil, {}), 201)).json().id as string;
    expect((await saveWir(id, civil, { checklist_template: foreignVersion })).statusCode).toBe(422);
    expect((await detail(tower.c1Engineer, id)).checklistCopies).toEqual([]);
  });

  it("a retired template isn't offered; WIRs that copied it keep their items", async () => {
    const retiring = await createTemplate({ ...pour(civil), name: bilingual("Kerbs") });
    const version = await latestVersion(retiring);
    const id = (await ok(createWir(civil, { checklist_template: version }), 201)).json().id as string;
    await ok(admin.post(`/v1/checklist-templates/${retiring}/retire`));
    const refused = await createWir(civil, { checklist_template: version });
    expect(refused.statusCode, refused.body).toBe(422);
    // The WIR keeps its pick and copy, saves again with it, and leaves Draft with it.
    await ok(saveWir(id, civil, { checklist_template: version, description: "Kerbs, gate 2" }), 204);
    expect((await detail(tower.c1Engineer, id)).checklistCopies.map((c) => [c.versionId, c.name.en, c.items.length])).toEqual([[version, "Kerbs", 3]]);
    await take(tower.c1Engineer, id, "send_for_review");
  });
});

// RP-1315 (ADR 0031): a template names an optional Scope or Sub-scope of its Trade, and a WIR with
// Scopes ticked is offered the whole-Trade templates and those on a ticked Scope.
describe("a template's Scope (RP-1315)", () => {
  let concrete = "";
  let footings = "";
  let masonry = "";
  let wiring = "";
  let whole = "";
  let concreteWorks = "";
  let footing = "";
  const addScope = async (tradeId: string, parentId: string | null, en: string) =>
    (await ok(admin.post(`/v1/projects/${tower.projectId}/scopes`, { tradeId, parentId, name: bilingual(en) }), 201)).json().id as string;
  beforeAll(async () => {
    concrete = await addScope(civil, null, "Concrete");
    footings = await addScope(civil, concrete, "Footings");
    masonry = await addScope(civil, null, "Masonry");
    wiring = await addScope(tower.electrical, null, "Wiring");
    whole = await createTemplate({ ...pour(civil), name: bilingual("Pour, any") });
    concreteWorks = await createTemplate({ ...pour(civil), name: bilingual("Concrete works"), scopeId: concrete });
    footing = await createTemplate({ ...pour(civil), name: bilingual("Footing"), scopeId: footings });
  });

  it("is created and read with the template, and an edit moves it to another Scope or back to the whole Trade", async () => {
    const listed = (id: string) => templates(tower.k1Manager).then((l) => l.templates.find((t) => t.id === id)!);
    expect(await listed(whole)).toMatchObject({ scopeId: null });
    expect(await listed(concreteWorks)).toMatchObject({ scopeId: concrete });
    expect(await listed(footing)).toMatchObject({ scopeId: footings });
    const moving = await createTemplate({ ...pour(civil), name: bilingual("Moving"), scopeId: masonry });
    await ok(admin.request("PUT", `/v1/checklist-templates/${moving}`, { ...pour(civil), name: bilingual("Moving"), scopeId: concrete }), 204);
    expect(await listed(moving)).toMatchObject({ versionNo: 2, scopeId: concrete });
    await ok(admin.request("PUT", `/v1/checklist-templates/${moving}`, { ...pour(civil), name: bilingual("Moving") }), 204);
    expect(await listed(moving)).toMatchObject({ versionNo: 3, scopeId: null });
  });

  it("RP-1315-1: another Participant's Members read a template's Scope with the template, and nobody off the Project does", async () => {
    const stranger = await api.authorizedPerson();
    const scopesRead = (by: Caller) =>
      readById<ChecklistTemplates>(`/v1/projects/${tower.projectId}/checklist-templates`)(by).then((lists) =>
        lists.flatMap((l) => l.templates.filter((t) => t.id === concreteWorks).map((t) => ({ id: t.scopeId ?? "" }))),
      );
    await expectHiddenFrom({ read: scopesRead, target: concrete, seenBy: [tower.k1Manager, k1Engineer, tower.c1Engineer], hiddenFrom: [stranger.caller], label: "a template's Scope" });
  });

  it("refuses another Trade's Scope, a deactivated one and a made-up one as scope_not_found (422)", async () => {
    const retired = await addScope(civil, null, "Retired");
    await ok(admin.request("PATCH", `/v1/scopes/${retired}`, { active: false }), 204);
    for (const scopeId of [wiring, retired, randomUUID()]) {
      const created = await admin.post(`/v1/projects/${tower.projectId}/checklist-templates`, { ...pour(civil), scopeId });
      expect(created.statusCode, created.body).toBe(422);
      expect(created.json()).toMatchObject({ error: "scope_not_found" });
      const edited = await admin.request("PUT", `/v1/checklist-templates/${whole}`, { ...pour(civil), name: bilingual("Pour, any"), scopeId });
      expect(edited.statusCode, edited.body).toBe(422);
      expect(edited.json()).toMatchObject({ error: "scope_not_found" });
    }
  });

  it("a WIR with no Scope ticked is offered every template of its Trade; with Scopes ticked the whole-Trade ones and a ticked Scope's", async () => {
    const pick = async (scopes: string[], id: string) => createWir(civil, { scopes, checklist_template: await latestVersion(id) });
    for (const id of [whole, concreteWorks, footing]) expect((await pick([], id)).statusCode).toBe(201);
    expect((await pick([concrete], whole)).statusCode).toBe(201);
    expect((await pick([concrete], concreteWorks)).statusCode).toBe(201);
    expect((await pick([concrete, footings], footing)).statusCode).toBe(201);
    for (const [scopes, id] of [[[concrete], footing], [[masonry], concreteWorks]] as const) {
      const refused = await pick([...scopes], id);
      expect(refused.statusCode, refused.body).toBe(422);
      expect(refused.json()).toMatchObject({ error: "invalid_answers", fields: [{ key: "checklist_template", code: "unknown_option" }] });
    }
    const created = (await ok(pick([concrete, footings], footing), 201)).json().id as string;
    expect((await detail(tower.c1Engineer, created)).checklistCopies.map((c) => c.templateId)).toEqual([footing]);
  });

  it("before the first Submit, unticking a Scope clears the pick and its copy; ticking one more keeps it", async () => {
    const picked = await latestVersion(concreteWorks);
    const id = (await ok(createWir(civil, { scopes: [concrete], checklist_template: picked }), 201)).json().id as string;
    await ok(saveWir(id, civil, { scopes: [concrete, masonry], checklist_template: picked }), 204);
    expect((await detail(tower.c1Engineer, id)).checklistCopies.map((c) => c.versionId)).toEqual([picked]);
    await ok(saveWir(id, civil, { scopes: [concrete], checklist_template: picked }), 204);
    const cleared = await detail(tower.c1Engineer, id);
    expect(cleared.answers.checklist_template).toBeUndefined(); // not hidden-from: the raiser's own pick was cleared
    expect(cleared.checklistCopies).toEqual([]); // not hidden-from: the raiser's own copy went with it
  });
});

describe("after a Send Back that lets the raiser edit the Form, the pick stays fixed", () => {
  const TYPE = "CKTSB";
  const schema = {
    sections: [
      { key: "work", title: bilingual("Work"), fields: [{ key: "model", type: "text", label: bilingual("Model") }, { key: "checklist_template", type: "checklist_template", label: bilingual("Checklist") }] },
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
  beforeAll(async () => {
    await addSendBackType(migrator, TYPE, bilingual("Checklist Send Back (test)"), schema, { afterSendBack: { draft: "edit_form", internal_review: "edit_form" } });
  });

  it("the raiser edits its other answers, but changing or taking back the Checklist Template is refused", async () => {
    const first = await createTemplate({ ...pour(civil), name: bilingual("Columns") });
    const second = await createTemplate({ ...pour(civil), name: bilingual("Walls") });
    const answers = (extra: Record<string, unknown>) => ({ model: "Columns C1-C8", trade: civil, location: tower.buildingA, ...extra });
    const picked = await latestVersion(first);
    const id = (await ok(tower.c1Engineer.post(`/v1/projects/${tower.projectId}/work-items`, { type: TYPE, title: "Columns", answers: answers({ checklist_template: picked }) }), 201)).json()
      .id as string;
    await take(tower.c1Engineer, id, "send_for_review");
    await ok(tower.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await take(tower.c1Pm, id, "submit");
    await ok(k1Engineer.post(`/v1/work-items/${id}/pick-up`));
    await take(k1Engineer, id, "send_back_to_draft");
    const save = (extra: Record<string, unknown>) => tower.c1Engineer.request("PUT", `/v1/work-items/${id}/answers`, { answers: answers(extra) });
    await ok(save({ checklist_template: picked, model: "Columns C1-C9" }), 204);
    for (const extra of [{ checklist_template: await latestVersion(second) }, {}]) {
      const res = await save(extra);
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json()).toMatchObject({ error: "not_editable" });
    }
    const item = await detail(tower.c1Engineer, id);
    expect(item.answers).toMatchObject({ model: "Columns C1-C9", checklist_template: picked });
    expect(item.checklistCopies.map((c) => c.versionId)).toEqual([picked]);
  });

  it("unticking a Scope keeps the fixed pick and its copy (owner, RP-1315 comment 15917)", async () => {
    const scope = async (en: string) =>
      (await ok(admin.post(`/v1/projects/${tower.projectId}/scopes`, { tradeId: civil, name: bilingual(en) }), 201)).json().id as string;
    const [beams, stairs] = [await scope("Beams"), await scope("Stairs")];
    const beamWork = await createTemplate({ ...pour(civil), name: bilingual("Beam pour"), scopeId: beams });
    const picked = await latestVersion(beamWork);
    const answers = (extra: Record<string, unknown>) => ({ model: "Beams B1-B4", trade: civil, location: tower.buildingA, ...extra });
    const id = (
      await ok(tower.c1Engineer.post(`/v1/projects/${tower.projectId}/work-items`, { type: TYPE, title: "Beams", answers: answers({ scopes: [beams, stairs], checklist_template: picked }) }), 201)
    ).json().id as string;
    await take(tower.c1Engineer, id, "send_for_review");
    await ok(tower.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await take(tower.c1Pm, id, "submit");
    await ok(k1Engineer.post(`/v1/work-items/${id}/pick-up`));
    await take(k1Engineer, id, "send_back_to_draft");
    // Beams unticked: the pick on Beams stays, as does its copy, and the save goes through.
    await ok(tower.c1Engineer.request("PUT", `/v1/work-items/${id}/answers`, { answers: answers({ scopes: [stairs], checklist_template: picked }) }), 204);
    const item = await detail(tower.c1Engineer, id);
    expect(item.answers).toMatchObject({ scopes: [stairs], checklist_template: picked });
    expect(item.checklistCopies.map((c) => c.versionId)).toEqual([picked]);
  });
});
