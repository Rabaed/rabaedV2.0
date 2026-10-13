// Seam 1 for the Project's own Form (RP-554; form-engine.md §7 "Which Form a new item
// gets"; visibility.md V13, V18). A Project created by a Company with a default Form for a
// Work Item Type has its own copy of it (RP-517); new items of that Type on the Project,
// whoever raises them, are pinned to the copy's latest published Version, and so is a
// Revision. A Project without one keeps the Type's Rabaed Default Form. Items already
// raised keep the Version they were pinned to.
import { randomUUID } from "node:crypto";
import { createDb, withMember } from "@rabaed/db";
import { LEGACY_MAR, testDatabaseUrls } from "@rabaed/db/test-support";
import type { FormToFill } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi } from "./support/harness.ts";
import { all, buildTower, detail, draft, ok, projectMember, submitted, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const label = (en: string) => ({ en, ar: en });

let tmc: Company; // Creates the Project; its Authorized Person marked the default Forms.
let k1: Company; // The Consultant.
let nobody: Company; // A Project Creator with no defaults.
let at: Tower; // TMC's Project: it has its own MAR and legacy MAR Forms.
let plain: Tower; // Nobody's Project: the Rabaed Default Forms.
const rabaed: Record<string, string> = {}; // Type code → the Rabaed Default Form's latest Version.
const copy: Record<string, string> = {}; // Type code → the Form definition of TMC's Project's copy.

const typeId = async (code: string) =>
  (await sql<{ id: string }>`select id from work_item_type where owner_kind = 'rabaed' and code = ${code}`.execute(migrator)).rows[0]!.id;

/** A published Form in TMC's Library for Type `code`, with the Rabaed Default's fields, marked as TMC's default. */
async function libraryDefault(code: string) {
  const { rows } = await sql<{ id: string }>`
    with f as (
      insert into form_definition (owner_kind, company_id, name, work_item_type_id)
      values ('company', ${tmc.company.companyId}::uuid, ${JSON.stringify(label(`TMC ${code} form`))}::jsonb, ${await typeId(code)}::uuid)
      returning id
    ), v as (
      insert into form_version (form_definition_id, version_no, status, schema, published_at)
      select f.id, 1, 'published', r.schema, now() from f, form_version r where r.id = app.latest_form_version(${code})
    )
    select id from f
  `.execute(migrator);
  await ok(tmc.caller.request("PUT", "/v1/company-defaults", { kind: "form", workItemTypeId: await typeId(code), itemId: rows[0]!.id }));
}

/** The Project's own Form for Type `code`, as the database holds it. */
async function projectForm(projectId: string, code: string): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    select f.id from form_definition f
    where f.owner_kind = 'project' and f.project_id = ${projectId}::uuid and f.work_item_type_id = ${await typeId(code)}::uuid
  `.execute(migrator);
  return rows[0]!.id;
}

/** Publishes Version `versionNo` of Form `formId`, with its Version 1's fields, and returns its id. */
async function publishVersion(formId: string, versionNo: number): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    insert into form_version (form_definition_id, version_no, status, schema, published_at)
    select form_definition_id, ${versionNo}, 'published', schema, now() from form_version
    where form_definition_id = ${formId}::uuid and version_no = 1
    returning id
  `.execute(migrator);
  return rows[0]!.id;
}

/** The latest published Version of Form `formId`. */
async function latestOf(formId: string): Promise<{ id: string; versionNo: number }> {
  const { rows } = await sql<{ id: string; version_no: number }>`
    select id, version_no from form_version where form_definition_id = ${formId}::uuid and status = 'published'
    order by version_no desc limit 1
  `.execute(migrator);
  return { id: rows[0]!.id, versionNo: rows[0]!.version_no };
}

const newItemForm = async (tower: Tower, by = tower.c1Engineer, code = "MAR"): Promise<FormToFill> =>
  (await ok(by.get(`/v1/projects/${tower.projectId}/work-item-types/${code}/form`), 200)).json();
const pinnedTo = async (tower: Tower, id: string) => (await detail(tower.c1Engineer, id)).formVersionId;

beforeAll(async () => {
  tmc = await api.projectCreator();
  k1 = await api.authorizedPerson();
  nobody = await api.projectCreator();
  for (const code of ["MAR", LEGACY_MAR]) {
    const { rows } = await sql<{ id: string }>`select app.latest_form_version(${code}) as id`.execute(migrator);
    rabaed[code] = rows[0]!.id;
    await libraryDefault(code);
  }
  at = await buildTower(api, { c1: tmc, k1 }, "PFC");
  plain = await buildTower(api, { c1: nobody, k1 }, "PFR");
  for (const code of ["MAR", LEGACY_MAR]) copy[code] = await projectForm(at.projectId, code);
});

describe("a new item on a Project with its own Form for the Type", () => {
  it("is filled in on the Project's copy, and pinned to it", async () => {
    const form = await newItemForm(at);
    expect({ id: form.id, versionNo: form.versionNo }).toEqual(await latestOf(copy.MAR!));
    expect(form.id).not.toBe(rabaed.MAR);

    const id = await draft(at, at.c1Engineer, "Cable tray", { type: "MAR" });
    expect(await pinnedTo(at, id)).toBe(form.id);
  });

  it("is on the Project's copy for a Company joining the Project too (ADR 0016)", async () => {
    const c2 = await api.authorizedPerson();
    const participantId = await api.addParticipant(tmc.caller, at.projectId, c2.company, "contractor");
    await ok(tmc.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
    const c2Engineer = await projectMember(api, c2, participantId, ["engineer"]);

    const form = await newItemForm(at, c2Engineer);
    expect(form.id).toBe((await latestOf(copy.MAR!)).id);
    const id = await draft(at, c2Engineer, "Conduit", { type: "MAR" });
    expect((await detail(c2Engineer, id)).formVersionId).toBe(form.id);
  });

  it("takes the copy's latest published Version; items already raised keep theirs", async () => {
    const first = await draft(at, at.c1Engineer, "Ducts", { type: "MAR" });
    const v1 = await pinnedTo(at, first);
    const v2 = await publishVersion(copy.MAR!, 2);

    expect((await newItemForm(at)).id).toBe(v2);
    expect(await pinnedTo(at, await draft(at, at.c1Engineer, "Pipes", { type: "MAR" }))).toBe(v2);
    expect(await pinnedTo(at, first)).toBe(v1);
  });

  it("starts a Revision on the copy's latest Version, not the Rabaed Default's", async () => {
    const id = await submitted(at, at.c1Engineer, at.c1Pm, "Fixtures");
    expect(await pinnedTo(at, id)).toBe((await latestOf(copy[LEGACY_MAR]!)).id);
    await ok(at.k1Manager.post(`/v1/work-items/${id}/pick-up`));
    await take(at.k1Manager, id, "revise_c", { remarks: "Resubmit with 110 lm/W luminaires" });
    const v2 = await publishVersion(copy[LEGACY_MAR]!, 2);

    const revision = (await ok(at.c1Engineer.post(`/v1/work-items/${id}/revisions`, { idempotencyKey: randomUUID() }), 201)).json().id as string;
    expect(await pinnedTo(at, revision)).toBe(v2);
    expect(await pinnedTo(at, id)).not.toBe(v2);
  });
});

describe("a new item on a Project without its own Form for the Type", () => {
  it("keeps the Type's Rabaed Default Form", async () => {
    expect((await newItemForm(plain)).id).toBe(rabaed.MAR);
    expect(await pinnedTo(plain, await draft(plain, plain.c1Engineer, "Cable tray", { type: "MAR" }))).toBe(rabaed.MAR);
  });

  it("moves to a Form the Project gains later, while items already raised keep the Rabaed one", async () => {
    const before = await draft(plain, plain.c1Engineer, "Ladders", { type: "MAR" });
    const { rows } = await sql<{ id: string }>`
      with f as (
        insert into form_definition (owner_kind, project_id, name, work_item_type_id)
        values ('project', ${plain.projectId}::uuid, ${JSON.stringify(label("Later MAR form"))}::jsonb, ${await typeId("MAR")}::uuid)
        returning id
      )
      insert into form_version (form_definition_id, version_no, status, schema, published_at)
      select f.id, 1, 'published', r.schema, now() from f, form_version r where r.id = ${rabaed.MAR}::uuid
      returning id
    `.execute(migrator);
    const later = rows[0]!.id;

    expect((await newItemForm(plain)).id).toBe(later);
    expect(await pinnedTo(plain, await draft(plain, plain.c1Engineer, "Trunking", { type: "MAR" }))).toBe(later);
    expect(await pinnedTo(plain, before)).toBe(rabaed.MAR);
  });
});

describe("another Project's Form (V13, V18)", () => {
  it("is never named to a Member who is not on that Project, whatever Project id they pass", async () => {
    const appDb = createDb(testDatabaseUrls().app, { max: 1 });
    try {
      const ask = (memberId: string) =>
        withMember(appDb, memberId, (trx) =>
          sql<{ id: string }>`select app.latest_form_version(${at.projectId}::uuid, 'MAR') as id`.execute(trx).then((r) => r.rows[0]!.id),
        );
      // TMC's Authorized Person is on the Project; Nobody's is not, and gets the Rabaed Default's.
      expect(await ask(tmc.company.authorizedPerson.id)).toBe((await latestOf(copy.MAR!)).id);
      expect(await ask(nobody.company.authorizedPerson.id)).toBe(rabaed.MAR);
    } finally {
      await appDb.destroy();
    }
  });
});
