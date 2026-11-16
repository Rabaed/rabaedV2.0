// Seam 2 for RP-1309 (owner's decision 2026-11-14, after RP-1299; visibility.md V15, V18, V20;
// scenarios RP-1309-1 to RP-1309-6). The narrowing is the api's (readsWorkflowOffProject in
// apps/api/src/projects/workflow-settings.ts): with no Project in the path, a Workflow is read only
// when Settings lists it to the Member on a Project they are on. What it is built on is what
// row-level security gives each reader as the app role, and that is what this file pins down: the
// Projects a Member is on (the ones the api looks through; a Member on no Project reads none), who
// is a Project Admin of which (app.current_admin_project_ids), which binding says which Workflow a
// Type runs, an exception's binding (its Participant's Members and the Project Admins only, V15),
// a Project copy's rows (every Member of the Project, V20) and a Library Workflow's (its own
// Company only, V18). The rows of a Workflow not in use stay open through the tables, so only the
// api's read leaves it out.
// Seam 1: apps/api/test/rp-1309-visibility.test.ts.
import { randomInt } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, digits, expectHiddenFrom, joinProject, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("");
const TYPE = `RU${letters(3)}`;

let migrator: pg.Client;
let app: Db;
const towerOptions = { projectCode: "RUP", otherProject: true } as const;
let tower: SeamTwoTower<typeof towerOptions>;
let typeId = "";
let running = ""; // The Rabaed Default the Type runs.
let unused = ""; // A second Rabaed Default of the Type, which nothing on the Tower runs.
let copy = ""; // A published Tower copy that no Type runs.
let library = ""; // A published Workflow in C2's Library.

const name: Record<string, string> = {};
const named = (member: string) => name[member] ?? member;
const ids = async <T extends { id: string }>(as: string, query: ReturnType<typeof sql<T>>) => (await tower.call<T>(as, query)).map((r) => ({ id: r.id }));
const nonAdmins = () => [tower.c1.members.engineer, tower.k1.members.engineer, tower.ow.members.representative, tower.c2.members.engineer];
const everyone = () => [tower.c1.ap, ...nonAdmins()];
/** C2's Authorized Person: a Member of a Participant, on no Project as a Project Member. */
const onNoProject = () => tower.c2.ap;

/** The Projects `as` is on: the ones the api looks through for a Settings that lists the Workflow. */
const projects = (as: string) => ids(as, sql<{ id: string }>`select id from project`);
const workflow = (id: string) => (as: string) => ids(as, sql<{ id: string }>`select id from workflow_definition where id = ${id}::uuid`);
/** Which Workflow the Type runs on the Tower, as `as` reads its binding. */
const runs = (as: string) =>
  ids(
    as,
    sql<{ id: string }>`select workflow_definition_id as id from workflow_binding
      where project_id = ${tower.projectId}::uuid and work_item_type_id = ${typeId}::uuid and raising_participant_id is null`,
  );
const admins = (as: string) => ids(as, sql<{ id: string }>`select x as id from app.current_admin_project_ids() x`);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const run = (text: string) => migrator.query(text);

  running = await addTestWorkflow(run, { name: bilingual(`RP-1309 running ${digits(6)}`) });
  unused = await addTestWorkflow(run, { name: bilingual(`RP-1309 unused ${digits(6)}`) });
  const formId = (await migrator.query("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Off the Project (RP-1309)"))])).rows[0].id as string;
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  typeId = (
    await migrator.query(
      `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
       values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4) returning id`,
      [TYPE, JSON.stringify(bilingual("Off the Project (RP-1309)")), running, formId],
    )
  ).rows[0].id as string;
  await migrator.query("update workflow_definition set work_item_type_id = $1 where id = any($2::uuid[])", [typeId, [running, unused]]);

  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  const { c1, k1, ow, c2, other } = tower;
  Object.assign(name, {
    [c1.ap]: "Tower's Project Admin",
    [c1.members.engineer]: "C1 engineer",
    [k1.members.engineer]: "K1 engineer",
    [ow.members.representative]: "the Owner",
    [c2.members.engineer]: "C2 engineer",
    [c2.ap]: "C2's Authorized Person, on no Project",
    [other.ap]: "a Member of another Project",
  });

  copy = await addTestWorkflow(run, { name: bilingual(`Tower unused ${digits(4)}`), owner: { kind: "project", projectId: tower.projectId } });
  library = await addTestWorkflow(run, { name: bilingual(`C2 library ${digits(4)}`), owner: { kind: "company", companyId: c2.id } });
  await migrator.query("update workflow_definition set work_item_type_id = $1 where id = any($2::uuid[])", [typeId, [copy, library]]);
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-1309-1: a Rabaed Default not in use", () => {
  it("every Member still reads its row through the tables (V20), a Member on no Project included: only the api's read leaves it out", async () => {
    for (const as of [...everyone(), onNoProject(), tower.other.ap]) expect(await workflow(unused)(as), named(as)).toEqual([{ id: unused }]); // not hidden-from: a Rabaed Default, visible to every Company (V18, V20)
  });

  it("the api looks only through the Projects the reader is on: the Tower for its Members, none for a Member on no Project", async () => {
    await expectHiddenFrom({ read: projects, target: tower.projectId, seenBy: everyone(), hiddenFrom: [onNoProject(), tower.other.ap], name: named, label: "the Tower" });
    expect(await projects(onNoProject())).toEqual([]); // not hidden-from: on no Project, so the api lists them no Workflow at all
  });
});

describe("scenario RP-1309-2: the Workflow a Type runs", () => {
  it("its binding is read by everyone on the Tower, and by no Member of another Project or on no Project", async () => {
    expect(await tower.outcome(tower.c1.ap, sql`select app.bind_workflow(${tower.projectId}::uuid, ${typeId}::uuid, null, ${running}::uuid, now()) as outcome`)).toBe("bound");
    await expectHiddenFrom({ read: runs, target: running, seenBy: everyone(), hiddenFrom: [onNoProject(), tower.other.ap], name: named, label: "the Type's binding" });
  });
});

describe("scenario RP-1309-3: what a Project Admin keeps", () => {
  it("only the Tower's Project Admin is a Project Admin of it, the one the api lists every Rabaed Default and copy to", async () => {
    await expectHiddenFrom({ read: admins, target: tower.projectId, seenBy: tower.c1.ap, hiddenFrom: [...nonAdmins(), onNoProject(), tower.other.ap], name: named, label: "the Tower's Project Admins" });
  });

  it("a copy no Type runs is read through the tables by every Member of the Tower (V20), and by no one else: only the api's read narrows it", async () => {
    await expectHiddenFrom({ read: workflow(copy), target: copy, seenBy: everyone(), hiddenFrom: [onNoProject(), tower.other.ap], name: named, label: "the Tower's unused copy" });
    for (const as of everyone()) expect(await runs(as), named(as)).not.toContainEqual({ id: copy }); // not hidden-from: no binding names it, for anyone
  });
});

describe("scenario RP-1309-4: an exception's Workflow", () => {
  it("the exception binding the unused Default is read by its Participant's Members and the Project Admin only (V15)", async () => {
    const { c1, c2 } = tower;
    expect(await tower.outcome(c1.ap, sql`select app.bind_workflow(${tower.projectId}::uuid, ${typeId}::uuid, ${c2.participantId}::uuid, ${unused}::uuid, now()) as outcome`)).toBe("bound");
    const excepted = (as: string) =>
      ids(
        as,
        sql<{ id: string }>`select workflow_definition_id as id from workflow_binding
          where project_id = ${tower.projectId}::uuid and work_item_type_id = ${typeId}::uuid and raising_participant_id is not null`,
      );
    await expectHiddenFrom({
      read: excepted,
      target: unused,
      seenBy: [c2.members.engineer, c1.ap],
      hiddenFrom: [c1.members.engineer, tower.k1.members.engineer, tower.ow.members.representative, onNoProject(), tower.other.ap],
      name: named,
      label: "the exception's binding",
    });
  });
});

describe("scenario RP-1309-5: a Library Workflow", () => {
  it("is read by its own Company's Members, on a Project or not, and by no other Company (V18)", async () => {
    await expectHiddenFrom({
      read: workflow(library),
      target: library,
      seenBy: [tower.c2.ap, tower.c2.members.engineer],
      hiddenFrom: [tower.c1.ap, tower.c1.members.engineer, tower.k1.members.engineer, tower.other.ap],
      name: named,
      label: "C2's Library Workflow",
    });
  });
});

describe("scenario RP-1309-6: a Project Admin of one Project who is only a Member of another", () => {
  it("is on both Projects, a Project Admin of the Tower only, so the api lists them the other Project's in-use Workflows only", async () => {
    const { c1, other } = tower;
    const there = await joinProject(app, other.projectId, { adminId: other.ap, crNumber: c1.cr, role: "contractor" }, c1.ap);
    await tower.call(c1.ap, sql<{ outcome: string }>`select app.add_project_member(${there}::uuid, ${c1.ap}::uuid, now()) as outcome`);
    expect((await projects(c1.ap)).map((p) => p.id).sort()).toEqual([tower.projectId, other.projectId].sort());
    await expectHiddenFrom({ read: admins, target: other.projectId, seenBy: other.ap, hiddenFrom: c1.ap, name: named, label: "the other Project's Project Admins" });
    expect(await admins(c1.ap)).toContainEqual({ id: tower.projectId }); // not hidden-from: their own Tower, for the contrast
  });
});
