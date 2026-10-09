// Seam 1 for a Project's Stages (RP-428, WF-5; spec RP-423; workflow-engine.md
// "Stages"; data-model.md stage). Each Project has its own Stage set per Module,
// seeded from the Rabaed Defaults; every Project Member reads it (they are the
// Kanban columns everyone sees), and only a Project Admin renames, adds,
// reorders or deletes one, and deletes only a Stage no Step of the Project's
// Workflows uses. The List, the Kanban and the Dashboard read the Project's
// Stages and their categories.
import { workItemSearchParams, type ProjectStages, type WorkItemBoard, type WorkItemList } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller, type TestApi } from "./support/harness.ts";
import { bilingual, buildTower, draft, ok, submitted, type Company, type Tower } from "./support/tower.ts";

let api: TestApi;
let c1: Company;
let k1: Company;
let outsider: Company;

beforeAll(async () => {
  api = await createTestApi({ files: true });
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  outsider = await api.projectCreator();
});

afterAll(async () => {
  await api?.close();
});

const stagesPath = (at: Tower, module = "submittals") => `/v1/projects/${at.projectId}/modules/${module}/stages`;
const stagesOf = async (by: Caller, at: Tower): Promise<ProjectStages> => (await ok(by.get(stagesPath(at)), 200)).json();
const rename = (by: Caller, at: Tower, key: string, name: { en: string; ar: string }) =>
  by.request("PATCH", `${stagesPath(at)}/${key}`, { name });
const add = (by: Caller, at: Tower, body: { key: string; name: { en: string; ar: string }; category: string }) => by.post(stagesPath(at), body);
const reorder = (by: Caller, at: Tower, keys: string[]) => by.request("PUT", `${stagesPath(at)}/order`, { keys });
const remove = (by: Caller, at: Tower, key: string) => by.request("DELETE", `${stagesPath(at)}/${key}`);

const list = async (by: Caller, at: Tower): Promise<WorkItemList> =>
  (await ok(by.get(`/v1/projects/${at.projectId}/work-items?${workItemSearchParams({})}`), 200)).json();
const board = async (by: Caller, at: Tower): Promise<WorkItemBoard> =>
  (await ok(by.get(`/v1/projects/${at.projectId}/work-items/kanban?${workItemSearchParams({})}`), 200)).json();

const rabaedDefaultKeys = ["draft", "internal_review", "pending_approval", "approved", "revise_resubmit", "cancelled"];

describe("a new Project's Stages", () => {
  it("are the Rabaed Defaults, read by every Project Member, editable by its Project Admin only", async () => {
    const t = await buildTower(api, { c1, k1 }, "STA");
    const byAdmin = await stagesOf(c1.caller, t);
    expect(byAdmin.canEdit).toBe(true);
    expect(byAdmin.stages.map((s) => s.key)).toEqual(rabaedDefaultKeys);
    expect(byAdmin.stages[0]).toEqual({ key: "draft", name: { en: "Drafts", ar: "المسودات" }, category: "draft", inUse: true });
    const byConsultant = await stagesOf(t.k1Manager, t);
    expect(byConsultant.canEdit).toBe(false);
    expect(byConsultant.stages).toEqual(byAdmin.stages);
  });

  it("are hidden from anyone not on the Project, as a made-up Project is", async () => {
    const t = await buildTower(api, { c1, k1 }, "STH");
    await expectHidden(outsider.caller.get(stagesPath(t)));
    await expectHidden(c1.caller.get(`/v1/projects/00000000-0000-4000-8000-000000000000/modules/submittals/stages`));
  });
});

describe("renaming a Stage", () => {
  it("changes the Kanban column and the List chip at once, in both languages; the counts stay", async () => {
    const t = await buildTower(api, { c1, k1 }, "STR");
    const item = await submitted(t, t.c1Engineer, t.c1Pm, "Cable trays");
    await draft(t, t.c1Engineer, "Lighting");
    const before = await board(t.k1Manager, t);

    await ok(rename(c1.caller, t, "pending_approval", { en: "With the Consultant", ar: "لدى الاستشاري" }));

    const after = await board(t.k1Manager, t);
    const column = after.stages.find((s) => s.key === "pending_approval")!;
    expect(column.name).toEqual({ en: "With the Consultant", ar: "لدى الاستشاري" });
    expect(after.stages.map((s) => [s.key, s.count])).toEqual(before.stages.map((s) => [s.key, s.count]));
    const chip = (await list(t.c1Pm, t)).items.find((i) => i.id === item)!.stage;
    expect(chip).toEqual({ key: "pending_approval", name: { en: "With the Consultant", ar: "لدى الاستشاري" }, category: "in_progress" });
    const detail = (await ok(t.c1Pm.get(`/v1/work-items/${item}`), 200)).json();
    expect(detail.stage.name.ar).toBe("لدى الاستشاري");
  });

  it("changes only that Project's Stages", async () => {
    const t = await buildTower(api, { c1, k1 }, "STO");
    const other = await buildTower(api, { c1, k1 }, "STP");
    await ok(rename(c1.caller, t, "approved", bilingual("Done")));
    expect((await stagesOf(c1.caller, other)).stages.find((s) => s.key === "approved")!.name.en).toBe("Approved");
  });

  it("is refused to a Project Member who isn't its Project Admin, and to anyone else as not found", async () => {
    const t = await buildTower(api, { c1, k1 }, "STN");
    await expectHidden(rename(t.k1Manager, t, "approved", bilingual("Done")));
    await expectHidden(rename(outsider.caller, t, "approved", bilingual("Done")));
    await expectHidden(rename(c1.caller, t, "no_such_stage", bilingual("Done")));
  });
});

describe("adding and reordering Stages", () => {
  it("adds a Stage with its category at the end, and reorders the columns", async () => {
    const t = await buildTower(api, { c1, k1 }, "STD");
    await ok(add(c1.caller, t, { key: "on_hold", name: { en: "On Hold", ar: "معلّق" }, category: "in_progress" }), 201);
    const added = (await stagesOf(c1.caller, t)).stages;
    expect(added.at(-1)).toEqual({ key: "on_hold", name: { en: "On Hold", ar: "معلّق" }, category: "in_progress", inUse: false });

    const order = ["draft", "internal_review", "on_hold", "pending_approval", "approved", "revise_resubmit", "cancelled"];
    await ok(reorder(c1.caller, t, order));
    expect((await stagesOf(c1.caller, t)).stages.map((s) => s.key)).toEqual(order);
    expect((await board(t.c1Pm, t)).columns.map((c) => c.stageKey)).toEqual(order);
  });

  it("refuses a key the Module already has, and an order that isn't exactly the Module's Stages", async () => {
    const t = await buildTower(api, { c1, k1 }, "STE");
    expect((await add(c1.caller, t, { key: "approved", name: bilingual("Again"), category: "closed_positive" })).statusCode).toBe(409);
    expect((await reorder(c1.caller, t, ["draft", "approved"])).statusCode).toBe(422);
    expect((await reorder(c1.caller, t, [...rabaedDefaultKeys.slice(1), "on_hold"])).statusCode).toBe(422);
    // The same key twice never reaches the database.
    expect((await reorder(c1.caller, t, [...rabaedDefaultKeys, "approved"])).statusCode).toBe(400);
    expect((await stagesOf(c1.caller, t)).stages.map((s) => s.key)).toEqual(rabaedDefaultKeys);
  });
});

describe("deleting a Stage", () => {
  it("is refused while a Step of the Project's Workflows uses it, and works once nothing does", async () => {
    const t = await buildTower(api, { c1, k1 }, "STX");
    const used = await remove(c1.caller, t, "pending_approval");
    expect(used.statusCode).toBe(409);
    expect(used.json()).toMatchObject({ error: "stage_in_use" });

    await ok(add(c1.caller, t, { key: "on_hold", name: bilingual("On Hold"), category: "in_progress" }), 201);
    await ok(remove(c1.caller, t, "on_hold"));
    expect((await stagesOf(c1.caller, t)).stages.map((s) => s.key)).toEqual(rabaedDefaultKeys);
  });

  it("is refused to a Project Member who isn't its Project Admin, as not found", async () => {
    const t = await buildTower(api, { c1, k1 }, "STY");
    await ok(add(c1.caller, t, { key: "on_hold", name: bilingual("On Hold"), category: "in_progress" }), 201);
    await expectHidden(remove(t.k1Manager, t, "on_hold"));
  });
});
