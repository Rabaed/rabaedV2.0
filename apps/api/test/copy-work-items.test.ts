// Seam 1 for the test helper that copies work items (RP-978 review): a copy is what the api would have made, so every row
// the create path wrote for the original is there for the copy, under the copy's own id, Subject and time.
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyWorkItems } from "./support/copy-work-items.ts";
import { createTestApi, type Caller } from "./support/harness.ts";
import { all, bilingual, ok, projectMember } from "./support/tower.ts";

const api = await createTestApi();
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

let engineer: Caller;
let projectId = "";
let scopeId = "";
let templateId = "";

beforeAll(async () => {
  const c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  const tradeId = (await ok(c1.caller.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") }), 201)).json().id;
  const locationId = (await ok(c1.caller.post(`/v1/projects/${projectId}/locations`, { code: "BA", name: bilingual("Building A"), parentId: null }), 201)).json().id;
  scopeId = (await ok(c1.caller.post(`/v1/projects/${projectId}/scopes`, { tradeId, parentId: null, name: bilingual("Lighting") }), 201)).json().id;
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`)).json().participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  engineer = await projectMember(api, c1, own, ["engineer"]);
  templateId = (
    await ok(engineer.post(`/v1/projects/${projectId}/work-items`, { type: "MAR", title: "Original", answers: { trade: tradeId, location: locationId, scopes: [scopeId] } }), 201)
  ).json().id;
});

describe("copying work items", () => {
  it("gives each copy its own Subject, Scope, time and created event", async () => {
    const at = "2026-02-03T04:05:06.789Z";
    const copy = { id: randomUUID(), title: "Copy", createdAt: at };
    const plain = { id: randomUUID(), title: "Plain copy" };
    await copyWorkItems(migrator, templateId, [copy, plain]);

    for (const { id, title } of [copy, plain]) {
      const detail = (await ok(engineer.get(`/v1/work-items/${id}`), 200)).json();
      expect(detail).toMatchObject({ title });
      expect(detail.answers.scopes).toEqual([scopeId]);
      const { rows } = await sql<{ title: string; item_created_at: Date }>`
        select e.payload ->> 'title' as title, w.created_at as item_created_at
        from work_item_event e join work_item w on w.id = e.work_item_id
        where e.work_item_id = ${id}::uuid and e.type = 'created'
      `.execute(migrator);
      expect(rows.map((r) => r.title)).toEqual([title]);
      if (id === copy.id) expect(rows[0]!.item_created_at.toISOString()).toBe(at);
    }
  });
});
