// Seam 5: a Rabaed Engineer maintains Option Lists in Rabaed Admin (RP-279,
// spec RP-278; form-engine.md §10). They create a three-level list, add,
// rename, retire and restore options; each edit writes admin_action with its
// reason; an edit without a reason is refused and changes nothing.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { OptionList, OptionNode } from "@rabaed/domain";
import { afterAll, describe, expect, it } from "vitest";
import { createTestAdmin, type Browser } from "./support/harness.ts";

const admin = await createTestAdmin();
// Reads the audit trail and the tables directly.
const adminDb = createDb(testDatabaseUrls().admin, { max: 1 });
afterAll(async () => {
  await admin.close();
  await adminDb.destroy();
});

const bi = (en: string, ar: string) => ({ en, ar });

async function newList(browser: Browser, reason = "Trade categories for the MAR Form"): Promise<string> {
  const res = await browser.post("/v1/option-lists", { name: bi("Material class", "فئة المادة"), reason });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id;
}

async function add(browser: Browser, listId: string, value: string, parentId: string | null = null, label = bi(value, `${value} ع`)) {
  const res = await browser.post(`/v1/option-lists/${listId}/options`, { parentId, value, label, reason: `Add ${value}` });
  return { res, id: res.statusCode === 201 ? (res.json().id as string) : "" };
}

async function find(browser: Browser, listId: string): Promise<OptionList> {
  const { optionLists } = (await browser.get("/v1/option-lists")).json() as { optionLists: OptionList[] };
  return optionLists.find((l) => l.id === listId)!;
}

const actionsOn = (targetId: string) =>
  adminDb
    .selectFrom("admin_action")
    .select(["engineer_id", "action", "target_kind", "reason", "before", "after"])
    .where("target_id", "=", targetId)
    .orderBy("at")
    .execute();

describe("a three-level Option List", () => {
  it("is created and filled by a Rabaed Engineer, each edit logged with its reason", async () => {
    const { id: engineerId, browser } = await admin.signedInEngineer();
    const listId = await newList(browser);
    const concrete = await add(browser, listId, "concrete");
    const precast = await add(browser, listId, "precast", concrete.id, bi("Precast", "مسبق الصب"));
    const panel = await add(browser, listId, "wall-panel", precast.id, bi("Wall panel", "لوح جداري"));
    const steel = await add(browser, listId, "steel");
    expect([concrete.res, precast.res, panel.res, steel.res].map((r) => r.statusCode)).toEqual([201, 201, 201, 201]);

    const list = await find(browser, listId);
    expect(list.name).toEqual(bi("Material class", "فئة المادة"));
    const tree = (nodes: OptionNode[]): unknown[] => nodes.map((n) => [n.value, n.retired, tree(n.options)]);
    expect(tree(list.options)).toEqual([
      ["concrete", false, [["precast", false, [["wall-panel", false, []]]]]],
      ["steel", false, []],
    ]);

    expect(await actionsOn(listId)).toEqual([
      expect.objectContaining({ engineer_id: engineerId, action: "create_option_list", target_kind: "option_list", reason: "Trade categories for the MAR Form" }),
    ]);
    expect(await actionsOn(panel.id)).toEqual([
      expect.objectContaining({
        engineer_id: engineerId,
        action: "add_option",
        target_kind: "option",
        reason: "Add wall-panel",
        after: expect.objectContaining({ level: 3, value: "wall-panel", parentId: precast.id }),
      }),
    ]);
  });

  it("refuses a fourth level, a repeated value, and a parent from another list; nothing is logged", async () => {
    const { browser } = await admin.signedInEngineer();
    const listId = await newList(browser);
    const a = await add(browser, listId, "a");
    const b = await add(browser, listId, "b", a.id);
    const c = await add(browser, listId, "c", b.id);

    const tooDeep = await add(browser, listId, "d", c.id);
    expect(tooDeep.res.statusCode).toBe(409);
    expect(tooDeep.res.json()).toEqual({ error: "too_deep" });
    expect((await add(browser, listId, "a")).res.json()).toEqual({ error: "duplicate_value" });
    // The same value is free in another list.
    expect((await add(browser, await newList(browser), "a")).res.statusCode).toBe(201);

    const other = await newList(browser);
    const strayParent = await add(browser, other, "x", a.id);
    expect(strayParent.res.statusCode).toBe(404);
    expect((await add(browser, "00000000-0000-4000-8000-000000000000", "x")).res.statusCode).toBe(404);

    const rows = await adminDb.selectFrom("option").select("value").where("option_list_id", "=", listId).execute();
    expect(rows.map((r) => r.value).sort()).toEqual(["a", "b", "c"]);
    const refused = await adminDb.selectFrom("admin_action").select("id").where("reason", "in", ["Add d"]).execute();
    expect(refused).toEqual([]);
  });

  it("renames an option's labels, keeping its value, and logs the labels before and after", async () => {
    const { browser } = await admin.signedInEngineer();
    const listId = await newList(browser);
    const { id } = await add(browser, listId, "ready-mix", null, bi("Ready mix", "خلطة جاهزة"));
    const res = await browser.post(`/v1/options/${id}/rename`, { label: bi("Ready-mixed concrete", "خرسانة جاهزة"), reason: "Clearer name" });
    expect(res.statusCode, res.body).toBe(204);

    expect((await find(browser, listId)).options[0]).toMatchObject({ value: "ready-mix", label: bi("Ready-mixed concrete", "خرسانة جاهزة") });
    const [, renamed] = await actionsOn(id);
    expect(renamed).toMatchObject({
      action: "rename_option",
      reason: "Clearer name",
      before: { value: "ready-mix", label: bi("Ready mix", "خلطة جاهزة") },
      after: { value: "ready-mix", label: bi("Ready-mixed concrete", "خرسانة جاهزة") },
    });
  });

  it("retires an option without deleting it, and restores it, each with its reason", async () => {
    const { browser } = await admin.signedInEngineer();
    const listId = await newList(browser);
    const parent = await add(browser, listId, "old");
    const child = await add(browser, listId, "old-child", parent.id);

    expect((await browser.post(`/v1/options/${parent.id}/retire`, { reason: "Superseded" })).statusCode).toBe(204);
    let list = await find(browser, listId);
    // Still there, marked, with its sub-options.
    expect(list.options).toMatchObject([{ value: "old", retired: true, options: [{ value: "old-child", retired: false }] }]);

    expect((await browser.post(`/v1/options/${parent.id}/restore`, { reason: "Still in use on site" })).statusCode).toBe(204);
    list = await find(browser, listId);
    expect(list.options[0]).toMatchObject({ value: "old", retired: false });

    expect((await actionsOn(parent.id)).map((a) => [a.action, a.reason])).toEqual([
      ["add_option", "Add old"],
      ["retire_option", "Superseded"],
      ["restore_option", "Still in use on site"],
    ]);
    expect(await actionsOn(child.id)).toHaveLength(1);
  });
});

describe("an edit without a reason", () => {
  it("is refused whatever it does, and changes and logs nothing", async () => {
    const { browser } = await admin.signedInEngineer();
    const listId = await newList(browser);
    const { id } = await add(browser, listId, "keep", null, bi("Keep", "ابقِ"));

    for (const reason of [undefined, "", "   "]) {
      const body = reason === undefined ? {} : { reason };
      const calls = [
        browser.post("/v1/option-lists", { name: bi("Unnamed", "بلا اسم"), ...body }),
        browser.post(`/v1/option-lists/${listId}/options`, { value: "nope", label: bi("No", "لا"), ...body }),
        browser.post(`/v1/options/${id}/rename`, { label: bi("Changed", "تغير"), ...body }),
        browser.post(`/v1/options/${id}/retire`, body),
        browser.post(`/v1/options/${id}/restore`, body),
      ];
      for (const res of await Promise.all(calls)) expect(res.statusCode).toBe(400);
    }

    const list = await find(browser, listId);
    expect(list.options).toMatchObject([{ value: "keep", label: bi("Keep", "ابقِ"), retired: false, options: [] }]);
    expect((await actionsOn(id)).map((a) => a.action)).toEqual(["add_option"]);
    const unnamed = await adminDb.selectFrom("option_list").select("id").where("name", "=", JSON.stringify(bi("Unnamed", "بلا اسم")) as never).execute();
    expect(unnamed).toEqual([]);
  });

  it("is also refused for a value or label that isn't valid", async () => {
    const { browser } = await admin.signedInEngineer();
    const listId = await newList(browser);
    const bad = [
      { value: "Upper Case", label: bi("A", "أ") },
      { value: "ok", label: { en: "English only" } },
    ];
    for (const option of bad) {
      expect((await browser.post(`/v1/option-lists/${listId}/options`, { ...option, reason: "x" })).statusCode).toBe(400);
    }
  });
});

describe("who may use the screens' API", () => {
  it("answers 401 to everything unless a Rabaed Engineer is signed in", async () => {
    const nobody = admin.browser();
    const id = "00000000-0000-4000-8000-000000000000";
    const calls = [
      nobody.get("/v1/option-lists"),
      nobody.post("/v1/option-lists", { name: bi("A", "أ"), reason: "x" }),
      nobody.post(`/v1/option-lists/${id}/options`, { value: "a", label: bi("A", "أ"), reason: "x" }),
      nobody.post(`/v1/options/${id}/rename`, { label: bi("A", "أ"), reason: "x" }),
      nobody.post(`/v1/options/${id}/retire`, { reason: "x" }),
      nobody.post(`/v1/options/${id}/restore`, { reason: "x" }),
    ];
    for (const res of await Promise.all(calls)) expect(res.statusCode).toBe(401);
  });
});

describe("the Option Lists screens", () => {
  it("are served with every label in English and Arabic", async () => {
    const page = (await admin.browser().get("/")).body;
    const script = (await admin.browser().get("/assets/admin.js")).body;
    expect(page).toContain('id="lists"');
    const [english, arabic] = script.split(/\n {2}ar: \{/);
    const keys = [...page.matchAll(/data-t="(\w+)"/g)].map((m) => m[1]!);
    expect(keys).toContain("listsTitle");
    for (const key of new Set(keys)) {
      expect(english, `en.${key}`).toMatch(new RegExp(`\n    ${key}:`));
      expect(arabic, `ar.${key}`).toMatch(new RegExp(`\n    ${key}:`));
    }
  });
});
