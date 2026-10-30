// Seam 1 for the copy of its Checklist Template a WIR makes (RP-651, INSP-3; spec RP-649;
// visibility.md V3, V20; scenario RP-651-2). Seam 2: packages/db/test/checklist-template-rls.test.ts.
// The template and the pick themselves are in checklist-templates.test.ts; this file is who reads
// the copy. Every "hidden" is proved with expectHiddenFrom: a reader who may see the row reads it
// first, by id (RP-1095).
//
// RP-651-2: C1's engineer raises a Civil WIR picking "Concrete pour": its Version 1 items are
// copied onto the WIR. The Project Admin then edits the template, and C1 Submits the WIR to K1.
// Before the Submit only C1 reads the copy, as it reads the Draft; after it K1 does too, still
// Version 1's items. C2, which doesn't cover Civil, and another Project's Admin read none, as for
// the WIR itself (V3). Only the Member who may save the WIR's answers changes its pick, and after
// the first Submit the pick and the copy are fixed.
import { expectHiddenFrom } from "@rabaed/db/test-support";
import type { ChecklistTemplates, WorkItemDetail } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, readById, type Caller } from "./support/harness.ts";
import { bilingual, buildTower, detail, ok, only, all, projectMember, take, type Tower } from "./support/tower.ts";

const api = await createTestApi();
afterAll(() => api.close());

const pourItems = [
  { key: "formwork", text: { en: "Formwork level and tight", ar: "القوالب مستوية ومحكمة" } },
  { key: "rebar_cover", text: { en: "Rebar cover as per drawing", ar: "غطاء حديد التسليح حسب المخطط" } },
  { key: "cubes", text: { en: "Cube samples taken", ar: "أخذ عينات المكعبات" }, answers: "yes_no_na", on_negative: "none" },
];

let tower: Tower;
let other: Tower; // Another Project, of another Contractor.
let civil = "";
let template = "";
let v1 = ""; // The template's Version 1, as the WIR picks it.
let k1Engineer: Caller; // K1's engineer: holds the Consultant Engineer Step once Submitted.
let c2Engineer: Caller; // C2, a second Contractor on Tower, covering Mechanical only.
let wir = "";

const names = new Map<Caller, string>();
const named = (by: Caller) => names.get(by) ?? "someone";

/** The WIR's checklist copies on its item page, each known by the template Version it copied; [] for the plain 404. */
const copiesRead = async (by: Caller) => (await readById<WorkItemDetail>(`/v1/work-items/${wir}`)(by)).flatMap((d) => d.checklistCopies.map((c) => ({ ...c, id: c.versionId })));
const latestVersion = async (id: string) =>
  ((await ok(tower.admin!.get(`/v1/projects/${tower.projectId}/checklist-templates`), 200)).json() as ChecklistTemplates).templates.find((t) => t.id === id)!.versionId;
const save = (by: Caller, checklist: string) =>
  by.request("PUT", `/v1/work-items/${wir}/answers`, {
    answers: { description: "Slab pour, level 2", requested_for: "2026-11-02T05:30:00.000Z", trade: civil, location: tower.buildingA, checklist_template: checklist },
  });

beforeAll(async () => {
  const c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  tower = await buildTower(api, { c1, k1 }, "CKV");
  other = await buildTower(api, { c1: await api.projectCreator(), k1: await api.authorizedPerson() }, "CKW");
  civil = (await ok(tower.admin!.post(`/v1/projects/${tower.projectId}/trades`, { code: "CV", name: bilingual("Civil") }), 201)).json().id as string;
  k1Engineer = await projectMember(api, k1, tower.k1ParticipantId!, ["engineer"]);
  const c2 = await api.authorizedPerson();
  const c2ParticipantId = await api.addParticipant(tower.admin!, tower.projectId, c2.company, "contractor");
  await ok(tower.admin!.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: only(tower.mechanical), location: all }));
  c2Engineer = await projectMember(api, c2, c2ParticipantId, ["engineer"]);
  const known: [Caller, string][] = [
    [tower.c1Engineer, "C1 engineer"], [tower.c1Pm, "C1 PM"], [tower.k1Manager, "K1 manager"], [k1Engineer, "K1 engineer"], [c2Engineer, "C2 engineer"], [other.admin!, "the other Project's Admin"],
  ];
  for (const [by, name] of known) names.set(by, name);

  template = (await ok(tower.admin!.post(`/v1/projects/${tower.projectId}/checklist-templates`, { name: { en: "Concrete pour", ar: "صب الخرسانة" }, tradeId: civil, items: pourItems }), 201)).json()
    .id as string;
  v1 = await latestVersion(template);
  wir = (
    await ok(
      tower.c1Engineer.post(`/v1/projects/${tower.projectId}/work-items`, {
        type: "WIR",
        title: "Slab pour, level 2",
        answers: { description: "Slab pour, level 2", requested_for: "2026-11-02T05:30:00.000Z", trade: civil, location: tower.buildingA, checklist_template: v1 },
      }),
      201,
    )
  ).json().id as string;
});

describe("RP-651-2: the copy of its Checklist Template on a WIR", () => {
  it("is C1's while the WIR is C1's: K1, C2 and another Project read none of it, as they read no Draft", async () => {
    await expectHiddenFrom({ read: copiesRead, target: v1, seenBy: tower.c1Engineer, hiddenFrom: [tower.k1Manager, k1Engineer, c2Engineer, other.admin!], name: named, label: "C1's Draft" });
  });

  it("stays Version 1's when the Project Admin edits the template", async () => {
    await ok(tower.admin!.request("PUT", `/v1/checklist-templates/${template}`, { name: { en: "Concrete pour, edited", ar: "صب الخرسانة" }, tradeId: civil, items: pourItems.slice(0, 2) }));
    expect(await latestVersion(template)).not.toBe(v1);
    const [copy] = await copiesRead(tower.c1Engineer);
    expect([copy!.versionId, copy!.versionNo, copy!.items.map((i) => i.key)]).toEqual([v1, 1, ["formwork", "rebar_cover", "cubes"]]);
  });

  it("once Submitted, K1 reads it too, still Version 1's items; C2 and another Project still read none", async () => {
    await take(tower.c1Engineer, wir, "send_for_review");
    await ok(tower.c1Pm.post(`/v1/work-items/${wir}/pick-up`));
    await take(tower.c1Pm, wir, "submit", { answers: { cover_note: "Ready from 09:00" } });
    const seenBy = [tower.c1Engineer, tower.k1Manager, k1Engineer];
    await expectHiddenFrom({ read: copiesRead, target: v1, seenBy, hiddenFrom: [c2Engineer, other.admin!], name: named, label: "Submitted" });
    for (const by of seenBy) expect((await copiesRead(by)).map((c) => [c.versionNo, c.items.length]), named(by)).toEqual([[1, 3]]);
    // C2 reads the WIR itself no more than its copy (V3).
    await expectHiddenFrom({ read: readById(`/v1/work-items/${wir}`), target: wir, seenBy, hiddenFrom: [c2Engineer, other.admin!], name: named, label: "the WIR" });
  });

  it("is fixed after the first Submit: its raiser, and K1 who sees it, can't change the pick, and the copy stays", async () => {
    const v2 = await latestVersion(template);
    for (const by of [tower.c1Engineer, k1Engineer]) {
      const refused = await save(by, v2);
      expect({ status: refused.statusCode, error: refused.json().error }, named(by)).toEqual({ status: 409, error: "not_editable" });
    }
    expect((await detail(tower.k1Manager, wir)).checklistCopies.map((c) => c.versionId)).toEqual([v1]);
  });
});
