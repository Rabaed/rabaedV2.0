// Seam 2 for RP-1323 (owner's decision 2026-11-18, after RP-1309; visibility.md V15, V18, V20;
// scenarios RP-1323-1 to RP-1323-4). The refusal is the api's: duplicate and save to Library ask
// readsWorkflowOffProject (apps/api/src/projects/workflow-settings.ts) before they call
// app.duplicate_workflow, so a source the Workflow's own reads answer with the 404 gets the same
// 404. What that rests on is what this file pins down, as the app role: the rows the api's filter
// reads (the Projects a Member is on, the bindings they read, the Projects they are a Project Admin
// of), and app.duplicate_workflow's own bound, which still holds for any caller: a target Project
// they administer or their own Library as its Authorized Person, and a published source whose rows
// they read. Inside that bound the database copies what the api would refuse, which is why the api
// must ask first; that the database doesn't refuse it too is the choice the PR explains.
// Seam 1: apps/api/test/rp-1323-visibility.test.ts.
import { randomInt } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, digits, expectHiddenFrom, joinProject, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("");
const TYPE = `RV${letters(3)}`;

let migrator: pg.Client;
let app: Db;
const towerOptions = { projectCode: "RVP", otherProject: true } as const;
let tower: SeamTwoTower<typeof towerOptions>;
let typeId = "";
let running = ""; // The Rabaed Default the Type runs.
let unused = ""; // A second Rabaed Default of the Type, which nothing on the Tower runs.
let ownCopy = ""; // A published Tower copy that no Type runs.
let theirCopy = ""; // A published copy of the other Project that no Type runs.
let library = ""; // A published Workflow in C2's Library.

const name: Record<string, string> = {};
const named = (member: string) => name[member] ?? member;
const ids = async <T extends { id: string }>(as: string, query: ReturnType<typeof sql<T>>) => (await tower.call<T>(as, query)).map((r) => ({ id: r.id }));
/** C2's Authorized Person: a Member of a Participant, on no Project as a Project Member. */
const onNoProject = () => tower.c2.ap;

/** The Projects `as` is on: the ones the api's filter looks through. */
const projects = (as: string) => ids(as, sql<{ id: string }>`select id from project`);
const admins = (as: string) => ids(as, sql<{ id: string }>`select x as id from app.current_admin_project_ids() x`);
/** `as` copies `source` into Project `projectId`, or into their Company's Library when null; the outcome. */
const duplicate = (as: string, source: string, projectId: string | null) =>
  tower.outcome(as, sql<{ outcome: string }>`select outcome from app.duplicate_workflow(${source}::uuid, ${projectId}::uuid, ${JSON.stringify(bilingual("A copy"))}::jsonb, now())`);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const run = (text: string) => migrator.query(text);

  running = await addTestWorkflow(run, { name: bilingual(`RP-1323 running ${digits(6)}`) });
  unused = await addTestWorkflow(run, { name: bilingual(`RP-1323 unused ${digits(6)}`) });
  const formId = (await migrator.query("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Copy sources (RP-1323)"))])).rows[0].id as string;
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  typeId = (
    await migrator.query(
      `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
       values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4) returning id`,
      [TYPE, JSON.stringify(bilingual("Copy sources (RP-1323)")), running, formId],
    )
  ).rows[0].id as string;

  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  const { c1, c2, other } = tower;
  Object.assign(name, {
    [c1.ap]: "the Tower's Project Admin, a Member of the other Project",
    [c1.members.engineer]: "C1 engineer",
    [c2.members.engineer]: "C2 engineer",
    [c2.ap]: "C2's Authorized Person, on no Project",
    [other.ap]: "the other Project's Project Admin",
  });

  ownCopy = await addTestWorkflow(run, { name: bilingual(`Tower unused ${digits(4)}`), owner: { kind: "project", projectId: tower.projectId } });
  theirCopy = await addTestWorkflow(run, { name: bilingual(`Other unused ${digits(4)}`), owner: { kind: "project", projectId: other.projectId } });
  library = await addTestWorkflow(run, { name: bilingual(`C2 library ${digits(4)}`), owner: { kind: "company", companyId: c2.id } });
  await migrator.query("update workflow_definition set work_item_type_id = $1 where id = any($2::uuid[])", [typeId, [running, unused, ownCopy, theirCopy, library]]);

  // C1 joins the other Project, and the Tower's Project Admin is a Project Member there, not its Project Admin.
  const there = await joinProject(app, other.projectId, { adminId: other.ap, crNumber: c1.cr, role: "contractor" }, c1.ap);
  await tower.call(c1.ap, sql<{ outcome: string }>`select app.add_project_member(${there}::uuid, ${c1.ap}::uuid, now()) as outcome`);
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-1323-1: the other Project's unused copy, for a Project Admin who is only a Member there", () => {
  it("they are on both Projects and a Project Admin of the Tower only, so the api's filter finds no Project of theirs that lists the other's unused copy", async () => {
    const { c1, other } = tower;
    expect((await projects(c1.ap)).map((p) => p.id).sort()).toEqual([tower.projectId, other.projectId].sort()); // not hidden-from: the Projects the filter looks through
    await expectHiddenFrom({ read: admins, target: other.projectId, seenBy: other.ap, hiddenFrom: c1.ap, name: named, label: "the other Project's Project Admins" });
  });

  it("its rows are theirs through the tables (V20), so app.duplicate_workflow alone would copy it: the api's check is what answers the 404", async () => {
    expect(await duplicate(tower.c1.ap, theirCopy, tower.projectId), "the database's bound, which the api narrows").toBe("duplicated");
  });
});

describe("scenario RP-1323-2: a source the Project Admin reads", () => {
  it("app.duplicate_workflow copies the Tower's copy and the Rabaed Defaults into the Tower, and the other Project's copy for its own Project Admin", async () => {
    for (const source of [ownCopy, running, unused]) expect(await duplicate(tower.c1.ap, source, tower.projectId), source).toBe("duplicated");
    expect(await duplicate(tower.other.ap, theirCopy, tower.other.projectId)).toBe("duplicated");
  });

  it("still refuses, for anyone, a target Project they don't administer and a source whose rows they don't read", async () => {
    const { c1, c2, other } = tower;
    expect(await duplicate(c1.ap, running, other.projectId), "into a Project they are only a Member of").toBe("not_found");
    expect(await duplicate(c1.members.engineer, running, tower.projectId), "by a Member who is not a Project Admin").toBe("not_found");
    expect(await duplicate(c1.ap, library, tower.projectId), "another Company's Library Workflow").toBe("not_found");
    expect(await duplicate(other.ap, ownCopy, other.projectId), "a copy of a Project they are not on").toBe("not_found");
    expect(await duplicate(c2.ap, library, null), "their own Company's Library, for the contrast").toBe("duplicated");
  });
});

describe("scenario RP-1323-3: save to Library", () => {
  it("app.duplicate_workflow copies into the Library for its Authorized Person only, from a source whose rows they read", async () => {
    const { c1, c2 } = tower;
    expect(await duplicate(c1.ap, ownCopy, null)).toBe("duplicated");
    expect(await duplicate(c1.members.engineer, ownCopy, null), "a Member who is not the Authorized Person").toBe("not_found");
    expect(await duplicate(c2.members.engineer, library, null), "C2's engineer, not its Authorized Person").toBe("not_found");
    expect(await duplicate(c1.ap, library, null), "another Company's Library Workflow").toBe("not_found");
  });
});

describe("scenario RP-1323-4: an Authorized Person on no Project", () => {
  it("is on no Project and a Project Admin of none, so the api's filter lists them no Rabaed Default, though its rows stay open (V20)", async () => {
    const hidden = { target: tower.projectId, seenBy: tower.c1.ap, hiddenFrom: onNoProject(), name: named };
    await expectHiddenFrom({ ...hidden, read: projects, label: "the Projects they are on" });
    await expectHiddenFrom({ ...hidden, read: admins, label: "the Projects they are a Project Admin of" });
    expect(await duplicate(onNoProject(), unused, null), "the database's bound; the api answers the 404").toBe("duplicated");
  });
});
