// Seam 5 (customer side) for Option Lists (RP-279, spec RP-278): every Member
// reads them, retired options marked; the customer app has no route that
// changes one (Rabaed Engineers edit them in Rabaed Admin).
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { addOption, createOptionList, setOptionRetired } from "@rabaed/admin/services";
import type { OptionList } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";

const api = await createTestApi();
const adminDb = createDb(testDatabaseUrls().admin, { max: 1 });
afterAll(async () => {
  await api.close();
  await adminDb.destroy();
});

const bi = (en: string, ar: string) => ({ en, ar });

let listId = "";
let retiredId = "";
let member: Caller;
let otherCompanyMember: Caller;

beforeAll(async () => {
  const engineerId = await api.engineer();
  listId = await createOptionList(adminDb, engineerId, { name: bi("Finish grade", "درجة التشطيب"), reason: "Seam test" });
  const add = async (value: string, parentId: string | null) => {
    const r = await addOption(adminDb, engineerId, listId, { parentId, value, label: bi(value, `${value} ع`), reason: "Seam test" });
    if (!r.ok) throw new Error(r.reason);
    return r.value;
  };
  const gloss = await add("gloss", null);
  await add("high-gloss", gloss);
  retiredId = await add("matt", null);
  await setOptionRetired(adminDb, engineerId, retiredId, true, "Seam test");
  member = (await api.authorizedPerson()).caller;
  otherCompanyMember = (await api.authorizedPerson()).caller;
});

const read = async (who: Caller): Promise<OptionList> => {
  const res = await who.get("/v1/option-lists");
  expect(res.statusCode, res.body).toBe(200);
  return (res.json().optionLists as OptionList[]).find((l) => l.id === listId)!;
};

describe("reading Option Lists", () => {
  it("is open to every Member, on or off a Project, with the whole tree and retired options marked", async () => {
    for (const who of [member, otherCompanyMember]) {
      const list = await read(who);
      expect(list.name).toEqual(bi("Finish grade", "درجة التشطيب"));
      expect(list.options).toMatchObject([
        { value: "gloss", retired: false, options: [{ value: "high-gloss", retired: false, options: [] }] },
        { id: retiredId, value: "matt", retired: true, options: [] },
      ]);
    }
  });

  it("is refused to anyone not signed in", async () => {
    expect((await api.anonymous().get("/v1/option-lists")).statusCode).toBe(401);
  });
});

describe("changing Option Lists", () => {
  it("has no route in the customer app: every way of writing is a 404", async () => {
    const id = "00000000-0000-4000-8000-000000000000";
    const body = { name: bi("A", "أ"), value: "a", label: bi("A", "أ"), reason: "x" };
    const paths = ["/v1/option-lists", `/v1/option-lists/${listId}`, `/v1/option-lists/${listId}/options`, `/v1/options/${id}`, `/v1/options/${id}/rename`, `/v1/options/${id}/retire`, `/v1/options/${id}/restore`];
    for (const path of paths) {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
        const res = await member.request(method, path, body);
        expect(res.statusCode, `${method} ${path}`).toBe(404);
      }
    }
    // Nothing changed.
    expect((await read(member)).options).toHaveLength(2);
  });
});
