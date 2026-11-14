// Seam 2 for RP-1299 (UAT round 0, WF-01; visibility.md V15, V20; scenarios RP-1299-1 to
// RP-1299-3). The narrowing is the api's (apps/api/src/projects/workflow-settings.ts): a Member
// who is not a Project Admin is listed only the Workflows in use. What it is built on is what
// row-level security gives each reader as the app role, and that is what this file pins down:
// who is a Project Admin (app.current_admin_project_ids), which binding says which Workflow a Type
// runs (read by everyone on the Project), an exception's binding (its Participant's Members and the
// Project Admins only, V15), and the rows of a Workflow not in use, which every Member still reads
// through the tables (V20: Rabaed Defaults are visible to every Company), so only the api's lists
// leave it out. A Member of another Project reads none of the Project's bindings.
// Seam 1: apps/api/test/rp-1299-visibility.test.ts.
import { randomInt } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, digits, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("");
const TYPE = `IU${letters(3)}`;

let migrator: pg.Client;
let app: Db;
const towerOptions = { projectCode: "IUP", otherProject: true } as const;
let tower: SeamTwoTower<typeof towerOptions>;
let typeId = "";
let running = ""; // The Rabaed Default the Type runs.
let unused = ""; // A second Rabaed Default of the Type, which nothing on the Tower runs.
let copy = ""; // A published Project copy, pinning the Project's Screen, which no Type runs at first.
let screenVersionId = "";

const name: Record<string, string> = {};
const named = (member: string) => name[member] ?? member;
const ids = async <T extends { id: string }>(as: string, query: ReturnType<typeof sql<T>>) => (await tower.call<T>(as, query)).map((r) => ({ id: r.id }));
const nonAdmins = () => [tower.c1.members.engineer, tower.k1.members.engineer, tower.ow.members.representative, tower.c2.members.engineer];
const everyone = () => [tower.c1.ap, ...nonAdmins()];

/** Which Workflow the Type runs on the Tower, as `as` reads its binding (none: the Type's own, the Rabaed Default). */
const runs = (as: string) =>
  ids(
    as,
    sql<{ id: string }>`select workflow_definition_id as id from workflow_binding
      where project_id = ${tower.projectId}::uuid and work_item_type_id = ${typeId}::uuid and raising_participant_id is null`,
  );

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const run = (text: string) => migrator.query(text);

  running = await addTestWorkflow(run, { name: bilingual(`RP-1299 running ${digits(6)}`) });
  unused = await addTestWorkflow(run, { name: bilingual(`RP-1299 unused ${digits(6)}`) });
  const formId = (await migrator.query("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("In use (RP-1299)"))])).rows[0].id as string;
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  typeId = (
    await migrator.query(
      `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
       values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4) returning id`,
      [TYPE, JSON.stringify(bilingual("In use (RP-1299)")), running, formId],
    )
  ).rows[0].id as string;
  // Both are the Type's Rabaed Defaults, as the eight submittal Workflows are (RP-596).
  await migrator.query("update workflow_definition set work_item_type_id = $1 where id = any($2::uuid[])", [typeId, [running, unused]]);

  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  const { c1, k1, ow, c2, other } = tower;
  Object.assign(name, {
    [c1.ap]: "Tower's Project Admin",
    [c1.members.engineer]: "C1 engineer",
    [k1.members.engineer]: "K1 engineer",
    [ow.members.representative]: "the Owner",
    [c2.members.engineer]: "C2 engineer",
    [other.ap]: "a Member of another Project",
  });

  const [screen] = await tower.call<{ outcome: string; screen_id: string }>(
    c1.ap,
    sql`select outcome, screen_id from app.create_screen(${tower.projectId}::uuid, ${`pin_${digits(6)}`}, ${JSON.stringify(bilingual("Reply"))}::jsonb,
      ${JSON.stringify({ sections: [{ key: "reply", title: bilingual("Reply"), fields: [{ key: "remarks", type: "textarea", label: bilingual("Remarks") }] }] })}::jsonb, '{}'::text[], now())`,
  );
  expect(screen!.outcome).toBe("created");
  expect(await tower.outcome(c1.ap, sql`select outcome from app.publish_screen(${screen!.screen_id}::uuid, now())`)).toBe("published");
  screenVersionId = (await migrator.query<{ id: string }>("select id from screen_version where screen_id = $1", [screen!.screen_id])).rows[0]!.id;
  copy = await addTestWorkflow(run, { name: bilingual(`Tower pinned ${digits(4)}`), owner: { kind: "project", projectId: tower.projectId }, screens: { approve_a: screenVersionId } });
  await migrator.query("update workflow_definition set work_item_type_id = $1 where id = $2", [typeId, copy]);
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-1299-1: who is listed every Rabaed Default", () => {
  it("only the Project Admin is a Project Admin of the Tower, the one the api lists every Rabaed Default to", async () => {
    const admin = (as: string) => ids(as, sql<{ id: string }>`select x as id from app.current_admin_project_ids() x where x = ${tower.projectId}::uuid`);
    await expectHiddenFrom({ read: admin, target: tower.projectId, seenBy: tower.c1.ap, hiddenFrom: [...nonAdmins(), tower.other.ap], name: named, label: "the Tower's Project Admins" });
  });

  it("every Member still reads a Rabaed Default no Type runs, through the tables (V20): only the api's list leaves it out", async () => {
    const workflow = (as: string) => ids(as, sql<{ id: string }>`select id from workflow_definition where id = ${unused}::uuid`);
    for (const as of [...everyone(), tower.other.ap]) expect((await workflow(as)).map((r) => r.id), named(as)).toEqual([unused]); // not hidden-from: a Rabaed Default, visible to every Company (V18, V20)
  });
});

describe("scenario RP-1299-2: what says a Workflow is in use for the reader", () => {
  it("the binding of the Workflow the Type runs is read by everyone on the Tower, and by no Member of another Project", async () => {
    expect(await tower.outcome(tower.c1.ap, sql`select app.bind_workflow(${tower.projectId}::uuid, ${typeId}::uuid, null, ${running}::uuid, now()) as outcome`)).toBe("bound");
    await expectHiddenFrom({ read: runs, target: running, seenBy: everyone(), hiddenFrom: tower.other.ap, name: named, label: "the Type's binding" });
  });

  it("an exception binding the unused Default is read by its Participant's Members and the Project Admin only (V15)", async () => {
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
      hiddenFrom: [c1.members.engineer, tower.k1.members.engineer, tower.ow.members.representative, tower.other.ap],
      name: named,
      label: "the exception's binding",
    });
  });
});

describe("scenario RP-1299-3: what a Screen pin names", () => {
  it("every Member reads the copy's pin through the tables; which Type runs the copy is read by everyone on the Tower once it is bound", async () => {
    const pins = (as: string) =>
      ids(
        as,
        sql<{ id: string }>`select wv.workflow_definition_id as id from workflow_transition t join workflow_version wv on wv.id = t.workflow_version_id
          where t.screen_version_id = ${screenVersionId}::uuid`,
      );
    await expectHiddenFrom({ read: pins, target: copy, seenBy: everyone(), hiddenFrom: tower.other.ap, name: named, label: "the copy's pin" });
    // No Type runs the copy yet: no binding names it, so the api lists its pin to the Project Admin only.
    for (const as of everyone()) expect((await runs(as)).map((r) => r.id), named(as)).not.toContain(copy); // not hidden-from: nobody reads it, the admin included
    expect(await tower.outcome(tower.c1.ap, sql`select app.bind_workflow(${tower.projectId}::uuid, ${typeId}::uuid, null, ${copy}::uuid, now()) as outcome`)).toBe("bound");
    await expectHiddenFrom({ read: runs, target: copy, seenBy: everyone(), hiddenFrom: tower.other.ap, name: named, label: "the binding of the copy, once the Type runs it" });
  });
});
