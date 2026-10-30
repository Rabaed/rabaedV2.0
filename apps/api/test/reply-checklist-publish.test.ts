// Seam 1: a reply checklist only on a Transition that closes the item (RP-1088; form-engine.md §3.3,
// decided 2026-10-31). Only a close takes a reply checklist: it raises the checklist's Snags and the
// Documental Record prints it. Taken by any other move, such as the Consultant Engineer's
// Recommendation to the Manager or a Recommendation into the Owner's review, nothing would do
// either. So publishing a Workflow refuses one in the Screen of such a Transition, and publishing
// a Screen refuses adding one while a Workflow shows the Screen there.
//
// The seam suites' global setup runs the migrations, then the demo seed, which publishes the
// Rabaed Defaults.
import { publishRabaedScreen } from "@rabaed/admin/services";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { WorkflowDefinition, WorkflowRead } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi } from "./support/harness.ts";
import { bilingual, buildTower, ok, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi();
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const remarks = { key: "remarks", type: "textarea", label: bilingual("Remarks") };
const checklist = { key: "inspection_checklist", type: "copied_checklist", copyOf: "checklist_template", label: bilingual("Checklist"), required: true };
/** A Screen schema of one section holding `fields`. */
const screenOf = (...fields: object[]) => ({ sections: [{ key: "reply", title: bilingual("Reply"), fields }] });

let c1: Company;
let at: Tower;
let wirWorkflowId = "";

const readWorkflow = async (id: string): Promise<WorkflowRead> => (await ok(c1.caller.get(`/v1/workflows/${id}`), 200)).json();
const saveDraft = async (id: string, definition: WorkflowDefinition) => ok(c1.caller.request("PUT", `/v1/workflows/${id}/draft`, { definition }), 200);

/** A Project copy of the WIR's Rabaed Default Workflow, its draft's definition changed by `change`; its id. */
async function wirCopy(name: string, change: (d: WorkflowDefinition) => void): Promise<string> {
  const copied = await c1.caller.post(`/v1/workflows/${wirWorkflowId}/duplicate`, { projectId: at.projectId, name: bilingual(name) });
  expect(copied.statusCode, copied.body).toBe(201);
  const id = copied.json().id as string;
  const definition = (await readWorkflow(id)).draft!.definition;
  change(definition);
  await saveDraft(id, definition);
  return id;
}

/** Transition `key` of `d` shows Screen `screen` instead of an Action Form of its own. */
const show = (d: WorkflowDefinition, key: string, screen: string) => Object.assign(d.transitions.find((t) => t.key === key)!, { actionForm: null, screen });

/** A Project Screen `key` with `schema`, published as Version 1; its id. */
async function projectScreen(key: string, schema: object): Promise<string> {
  const created = await c1.caller.post(`/v1/projects/${at.projectId}/screens`, { key, name: bilingual(key), schema, internalFields: [], publish: true });
  expect(created.statusCode, created.body).toBe(201);
  return created.json().id as string;
}

beforeAll(async () => {
  c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "RCP");
  const type = await sql<{ workflow_definition_id: string }>`
    select workflow_definition_id from work_item_type where owner_kind = 'rabaed' and code = 'WIR'
  `.execute(migrator);
  wirWorkflowId = type.rows[0]!.workflow_definition_id;
});

describe("publishing a Workflow (seam 1)", () => {
  it("refuses the WIR's code Screen, checklist and all, on the Engineer's Recommendation to the Manager, naming the Transition and the field", async () => {
    const id = await wirCopy("WIR with the checklist on Send to Manager", (d) => show(d, "send_to_manager", "inspection_code_a"));
    const refused = await c1.caller.post(`/v1/workflows/${id}/publish`);
    expect(refused.statusCode, refused.body).toBe(422);
    const body = refused.json() as { error: string; problems: { code: string; transition?: string; detail?: string; message: { en: string; ar: string } }[] };
    expect(body.error).toBe("workflow_problems");
    expect(body.problems.filter((p) => p.code === "reply_checklist_not_on_close")).toEqual([
      expect.objectContaining({ transition: "send_to_manager", detail: "inspection_checklist", severity: "error" }),
    ]);
    const [problem] = body.problems.filter((p) => p.code === "reply_checklist_not_on_close");
    expect(problem!.message.en).toContain("doesn't close the item");
    expect(problem!.message.ar).toContain("لا يُغلق العنصر");
    // Nothing was published.
    expect((await readWorkflow(id)).publishedVersions).toEqual([]);

    // Taken back, the same copy publishes: the WIR's codes, which close it, keep the checklist.
    const definition = (await readWorkflow(id)).draft!.definition;
    delete definition.transitions.find((t) => t.key === "send_to_manager")!.screen;
    await saveDraft(id, definition);
    expect((await c1.caller.post(`/v1/workflows/${id}/publish`)).statusCode).toBe(200);
  });
});

describe("publishing a Screen (seam 1)", () => {
  let offClose = "";
  let onClose = "";

  beforeAll(async () => {
    // Two Project Screens with no checklist yet: one the Project's WIR shows on Send to Manager, one on Approve · A.
    offClose = await projectScreen("site_note", screenOf(remarks));
    onClose = await projectScreen("site_code_a", screenOf(remarks));
    const id = await wirCopy("WIR with the Project's own Screens", (d) => {
      show(d, "send_to_manager", "site_note");
      show(d, "approve_a", "site_code_a");
    });
    expect((await c1.caller.post(`/v1/workflows/${id}/publish`)).statusCode).toBe(200);
  });

  it("refuses adding a checklist to a Screen a Workflow shows on a Transition that doesn't close the item: its next publish would take it there", async () => {
    await ok(c1.caller.request("PUT", `/v1/screens/${offClose}/draft`, { schema: screenOf(remarks, checklist), internalFields: [] }), 200);
    const refused = await c1.caller.post(`/v1/screens/${offClose}/publish`);
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json()).toEqual({ error: "screen_problems", problems: [{ key: "inspection_checklist", code: "reply_checklist_not_on_close" }] });
    expect((await ok(c1.caller.get(`/v1/screens/${offClose}`), 200)).json().publishedVersions).toEqual([1]);
  });

  it("takes it on a Screen every Workflow showing it shows on a close", async () => {
    await ok(c1.caller.request("PUT", `/v1/screens/${onClose}/draft`, { schema: screenOf(remarks, checklist), internalFields: [] }), 200);
    expect((await ok(c1.caller.post(`/v1/screens/${onClose}/publish`), 200)).json()).toEqual({ versionNo: 2 });
  });
});

describe("publishing a Rabaed Default Screen (Rabaed Admin, seam 1)", () => {
  const KEY = "rp1088_site_note";
  const document = (name: string, schema: object) => ({ key: KEY, name: bilingual(name), schema, internalFields: [] });

  beforeAll(async () => {
    // A test-only Rabaed Default Screen with no checklist yet, which the Project's WIR falls back to on Send to Manager.
    expect(await publishRabaedScreen(migrator, document("Site note", screenOf(remarks)))).toMatchObject({ ok: true, published: true, versionNo: 1 });
    const id = await wirCopy("WIR with a Rabaed Default Screen on Send to Manager", (d) => show(d, "send_to_manager", KEY));
    expect((await c1.caller.post(`/v1/workflows/${id}/publish`)).statusCode).toBe(200);
  });

  it("refuses adding a checklist while a Project's published Workflow shows it off a close, and writes nothing, its name included", async () => {
    expect(await publishRabaedScreen(migrator, document("Site note with checks", screenOf(remarks, checklist)))).toEqual({
      ok: false,
      reason: "screen_problems",
      problems: [{ key: "inspection_checklist", code: "reply_checklist_not_on_close" }],
    });
    const { rows } = await sql<{ name: { en: string }; versions: number }>`
      select s.name, (select count(*)::int from screen_version v where v.screen_id = s.id) as versions
      from screen s where s.owner_kind = 'rabaed' and s.key = ${KEY}
    `.execute(migrator);
    expect(rows).toEqual([{ name: bilingual("Site note"), versions: 1 }]);
  });

  it("publishes the same content again as nothing new, whatever shows it", async () => {
    expect(await publishRabaedScreen(migrator, document("Site note", screenOf(remarks)))).toMatchObject({ ok: true, published: false, versionNo: 1 });
  });
});

describe("every published Workflow Version (seam 1)", () => {
  // The Rabaed Defaults the seed published, and every Project's: none shows a reply checklist off a close (RP-1088).
  // A published Version's action_form holds its pinned Screen's schema, a copy (workflow-engine.md §5.7), so it is read there.
  it("shows a reply checklist only on a Transition that closes the item", async () => {
    const { rows } = await sql<{ workflow: string; version_no: number; transition: string }>`
      select d.name ->> 'en' as workflow, v.version_no, t.key as transition
      from workflow_transition t
      join workflow_version v on v.id = t.workflow_version_id and v.status = 'published'
      join workflow_definition d on d.id = v.workflow_definition_id
      where t.kind <> 'close'
        and jsonb_path_exists(coalesce(t.action_form, 'null'), '$.sections[*].fields[*] ? (@.type == "copied_checklist")')
      order by 1, 2, 3
    `.execute(migrator);
    expect(rows).toEqual([]);
  });
});
