// Seam 2 for who changes a Project's Workflows and what a binding may name (RP-427, WF-4; spec
// RP-423; ADR 0016; workflow-engine.md §1 "Authoring"; visibility.md V15, V18, V20; scenarios
// RP-427-1, RP-427-2, RP-427-4), as the app role, the migrator counting what changed:
// - RP-427-1: a C1 Member who isn't a Project Admin, K1's Authorized Person and another Project's
//   Project Admin duplicate into the Tower, save, validate (app.can_author_workflow and the draft it
//   checks), publish, bind and unbind; each is refused as for a made-up id and nothing changes. Nobody
//   changes a Rabaed Default. The Tower's Project Admin, the positive control, does each.
// - RP-427-2: binding the MAR to another Project's Workflow, a Library Workflow or a made-up id is
//   refused alike; the Library one, copied into the Tower first, binds.
// - RP-427-4: an exception Workflow named after C2's Company is refused, then renamed; C2's new MARs
//   run it, and C1 and K1 read it without learning whom it is for (the exception binding).
// Seam 1: apps/api/test/workflow-authoring.test.ts.
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { bilingual, buildSeamTwoTower, c2Draft, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();

let migrator: pg.Client;
let app: Db;
const towerOptions = { projectCode: "RVA", otherProject: true, checklistTemplate: false } as const;
let tower: SeamTwoTower<typeof towerOptions>;
let marTypeId = "";
let marDefault = "";
const names = new Map<string, string>();
const named = (as: string) => names.get(as) ?? as;

type Duplicated = { outcome: string; workflow_definition_id: string | null };
type Saved = { outcome: string; workflow_version_id: string | null; version_no: number | null };
type DraftRows = { workflow_version_id: string; layout: unknown; steps: unknown; transitions: unknown };

const duplicate = (as: string, source: string, projectId: string | null, name = bilingual("Copy")) =>
  tower.call<Duplicated>(as, sql`select outcome, workflow_definition_id from app.duplicate_workflow(${source}::uuid, ${projectId}::uuid, ${JSON.stringify(name)}::jsonb, now())`);
const draftOf = (as: string, id: string) =>
  tower.call<DraftRows>(as, sql`select workflow_version_id, layout, steps, transitions from app.workflow_draft(${id}::uuid)`);
const save = (as: string, id: string, rows: Omit<DraftRows, "workflow_version_id">, name: { en: string; ar: string } | null = null) =>
  tower.call<Saved>(
    as,
    sql`select outcome, workflow_version_id, version_no from app.save_workflow_draft(${id}::uuid, ${name === null ? null : JSON.stringify(name)}::jsonb,
      ${JSON.stringify(rows.layout)}::jsonb, ${JSON.stringify(rows.steps)}::jsonb, ${JSON.stringify(rows.transitions)}::jsonb, now())`,
  );
const canAuthor = async (as: string, id: string) => (await tower.call<{ can: boolean }>(as, sql`select app.can_author_workflow(${id}::uuid) as can`))[0]!.can;
const publish = (as: string, id: string) => tower.call<Saved>(as, sql`select outcome, workflow_version_id, version_no from app.publish_workflow(${id}::uuid, now())`);
const bind = (as: string, projectId: string, id: string, participantId: string | null = null) =>
  tower.outcome(as, sql`select app.bind_workflow(${projectId}::uuid, ${marTypeId}::uuid, ${participantId}::uuid, ${id}::uuid, now()) as outcome`);
const unbind = (as: string, projectId: string) => tower.outcome(as, sql`select app.unbind_workflow(${projectId}::uuid, ${marTypeId}::uuid, null, now()) as outcome`);

/** A published copy of the MAR's Rabaed Default, by `as`, into `projectId` (null: their Company's Library). */
async function publishedCopy(as: string, projectId: string | null, name: { en: string; ar: string }): Promise<string> {
  const [copy] = await duplicate(as, marDefault, projectId, name);
  expect(copy!.outcome).toBe("duplicated");
  expect((await publish(as, copy!.workflow_definition_id!))[0]!.outcome).toBe("published");
  return copy!.workflow_definition_id!;
}

/** What the Tower's Workflows are, as the migrator reads them: its Workflows' Versions, its bindings, and a Rabaed Default's Versions. */
async function towerState(...definitions: string[]) {
  const q = async (text: string, values: unknown[]) => (await migrator.query(text, values)).rows;
  return {
    definitions: await q("select id, name from workflow_definition where project_id = $1 order by id", [tower.projectId]),
    versions: await q("select workflow_definition_id, version_no, status, draft_name from workflow_version where workflow_definition_id = any($1) order by workflow_definition_id, version_no", [
      definitions,
    ]),
    bindings: await q("select work_item_type_id, raising_participant_id, workflow_definition_id from workflow_binding where project_id = $1 order by id", [tower.projectId]),
  };
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const mar = (await migrator.query("select id, workflow_definition_id from work_item_type where owner_kind = 'rabaed' and code = 'MAR'")).rows[0];
  marTypeId = mar.id as string;
  marDefault = mar.workflow_definition_id as string;
  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  const { c1, k1, c2, other } = tower;
  for (const [as, name] of [
    [c1.ap, "the Tower's Project Admin"],
    [c1.members.engineer, "a C1 Member who isn't a Project Admin"],
    [k1.ap, "K1's Authorized Person"],
    [k1.members.engineer, "K1's Engineer"],
    [c2.members.engineer, "C2's Engineer"],
    [other.ap, "another Project's Project Admin"],
  ] as const)
    names.set(as, name);
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-427-1: nobody but the Tower's Project Admin changes its Workflows (seam 2)", () => {
  let route = "";
  let rows: DraftRows;

  beforeAll(async () => {
    // The Tower's route, published and bound, with a draft of its next Version waiting.
    route = await publishedCopy(tower.c1.ap, tower.projectId, bilingual("Kept route"));
    expect(await bind(tower.c1.ap, tower.projectId, route)).toBe("bound");
    const [published] = await migrator.query(
      "select r.layout, r.steps, r.transitions from workflow_version v cross join lateral app.workflow_version_rows(v.id) r where v.workflow_definition_id = $1 and v.status = 'published'",
      [route],
    ).then((r) => r.rows);
    expect((await save(tower.c1.ap, route, published))[0]!.outcome).toBe("saved");
    rows = (await draftOf(tower.c1.ap, route))[0]!;
  });

  it("refuses each command as for a made-up id, and nothing changes", async () => {
    const { c1, k1, other } = tower;
    const madeUp = randomUUID();
    // What a made-up id gets, asked by the Project Admin, who may do all of it on the Tower.
    const refusal = {
      duplicate: await duplicate(c1.ap, madeUp, tower.projectId),
      save: await save(c1.ap, madeUp, rows),
      validate: await canAuthor(c1.ap, madeUp),
      publish: await publish(c1.ap, madeUp),
      bind: await bind(c1.ap, randomUUID(), route),
      unbind: await unbind(c1.ap, randomUUID()),
    };
    expect(refusal).toEqual({
      duplicate: [{ outcome: "not_found", workflow_definition_id: null }],
      save: [{ outcome: "not_found", workflow_version_id: null, version_no: null }],
      validate: false,
      publish: [{ outcome: "not_found", workflow_version_id: null, version_no: null }],
      bind: "not_found",
      unbind: "not_found",
    });
    const before = await towerState(route, marDefault);
    for (const as of [c1.members.engineer, k1.ap, other.ap]) {
      expect(
        {
          duplicate: await duplicate(as, marDefault, tower.projectId),
          save: await save(as, route, rows),
          validate: await canAuthor(as, route),
          publish: await publish(as, route),
          bind: await bind(as, tower.projectId, route),
          unbind: await unbind(as, tower.projectId),
        },
        named(as),
      ).toEqual(refusal);
    }
    // The draft validate would check is its Project Admin's to read alone.
    await expectHiddenFrom({
      read: (as: string) => draftOf(as, route),
      target: rows.workflow_version_id,
      idOf: (r) => r.workflow_version_id,
      seenBy: c1.ap,
      hiddenFrom: [c1.members.engineer, k1.ap, other.ap],
      name: named,
      label: "the Tower route's draft",
    });
    expect(await towerState(route, marDefault)).toEqual(before);
  });

  it("changes no Rabaed Default, whoever asks, the Project Admin included", async () => {
    const { c1, k1, other } = tower;
    const [published] = await migrator.query(
      "select r.layout, r.steps, r.transitions from workflow_version v cross join lateral app.workflow_version_rows(v.id) r where v.workflow_definition_id = $1 and v.status = 'published' order by v.version_no desc limit 1",
      [marDefault],
    ).then((r) => r.rows);
    const before = await towerState(marDefault);
    for (const as of [c1.ap, c1.members.engineer, k1.ap, other.ap]) {
      expect(
        { save: (await save(as, marDefault, published))[0]!.outcome, validate: await canAuthor(as, marDefault), publish: (await publish(as, marDefault))[0]!.outcome },
        named(as),
      ).toEqual({ save: "not_found", validate: false, publish: "not_found" });
    }
    expect(await towerState(marDefault)).toEqual(before);
  });

  it("lets the Tower's Project Admin do each of them (the positive control)", async () => {
    const { c1 } = tower;
    expect((await duplicate(c1.ap, marDefault, tower.projectId, bilingual("Another route")))[0]!.outcome).toBe("duplicated");
    expect(await canAuthor(c1.ap, route)).toBe(true);
    expect((await save(c1.ap, route, rows))[0]).toMatchObject({ outcome: "saved", version_no: 2 });
    expect((await publish(c1.ap, route))[0]).toMatchObject({ outcome: "published", version_no: 2 });
    expect(await unbind(c1.ap, tower.projectId)).toBe("unbound");
    expect(await bind(c1.ap, tower.projectId, route)).toBe("bound");
  });
});

describe("scenario RP-427-2: a binding names the Tower's own Workflow or a Rabaed Default (seam 2)", () => {
  it("refuses another Project's Workflow, a Library Workflow and a made-up id alike; the Library one binds once copied into the Tower", async () => {
    const { c1, other } = tower;
    const own = await publishedCopy(c1.ap, tower.projectId, bilingual("Own route"));
    const othersRoute = await publishedCopy(other.ap, other.projectId, bilingual("Elsewhere route"));
    const library = await publishedCopy(c1.ap, null, bilingual("C1 Library route"));
    const before = await towerState();
    expect({
      othersRoute: await bind(c1.ap, tower.projectId, othersRoute),
      library: await bind(c1.ap, tower.projectId, library),
      madeUp: await bind(c1.ap, tower.projectId, randomUUID()),
    }).toEqual({ othersRoute: "not_found", library: "not_found", madeUp: "not_found" });
    expect(await towerState()).toEqual(before);

    // The positive controls: the Tower's own Workflow binds, and so does the Library one once copied in (V18).
    expect(await bind(c1.ap, tower.projectId, own)).toBe("bound");
    const [copied] = await duplicate(c1.ap, library, tower.projectId, bilingual("From the Library"));
    expect(copied!.outcome).toBe("duplicated");
    expect((await publish(c1.ap, copied!.workflow_definition_id!))[0]!.outcome).toBe("published");
    expect(await bind(c1.ap, tower.projectId, copied!.workflow_definition_id!)).toBe("bound");
  });
});

describe("scenario RP-427-4: an exception's Workflow never names its Participant (seam 2)", () => {
  // C2's Company is "C2" (buildSeamTwoTower), so a name holding "C2" names it.
  const NAMED = bilingual("C2 MARs");
  const SHORT = bilingual("MARs, short route");
  let route = "";
  let binding = "";

  it("refuses the exception while the name names C2, renamed it binds, and a rename back is refused", async () => {
    const { c1, c2 } = tower;
    route = await publishedCopy(c1.ap, tower.projectId, NAMED);
    expect(await bind(c1.ap, tower.projectId, route, c2.participantId)).toBe("workflow_name_names_participant");
    const exceptions = async () =>
      (await migrator.query("select id from workflow_binding where project_id = $1 and raising_participant_id = $2", [tower.projectId, c2.participantId])).rows;
    expect(await exceptions()).toEqual([]); // not hidden-from: the refused bind wrote no binding, read by the migrator

    const [published] = await migrator.query(
      "select r.layout, r.steps, r.transitions from workflow_version v cross join lateral app.workflow_version_rows(v.id) r where v.workflow_definition_id = $1 and v.status = 'published'",
      [route],
    ).then((r) => r.rows);
    expect((await save(c1.ap, route, published, SHORT))[0]!.outcome).toBe("saved");
    expect((await publish(c1.ap, route))[0]!.outcome).toBe("published");
    expect(await bind(c1.ap, tower.projectId, route, c2.participantId)).toBe("bound");
    binding = (await exceptions())[0]!.id as string;

    expect((await save(c1.ap, route, published, NAMED))[0]!.outcome).toBe("workflow_name_names_participant");
    const name = (await migrator.query("select name from workflow_definition where id = $1", [route])).rows[0].name;
    expect(name).toEqual(SHORT);
  });

  it("is what C2's new MARs run", async () => {
    const item = await c2Draft(tower, { type: "MAR", title: "Facade panels" });
    const { rows } = await migrator.query("select v.workflow_definition_id as id from work_item w join workflow_version v on v.id = w.workflow_version_id where w.id = $1", [item]);
    expect(rows[0].id).toBe(route);
  });

  it("is read by C1 and K1 by its name, and the exception that says whom it is for is not", async () => {
    const { c1, k1, c2 } = tower;
    const definition = (as: string) => tower.call<{ id: string; name: unknown }>(as, sql`select id, name from workflow_definition where id = ${route}::uuid`);
    for (const as of [c1.members.engineer, k1.members.engineer, c2.members.engineer]) expect(await definition(as), named(as)).toEqual([{ id: route, name: SHORT }]);
    await expectHiddenFrom({
      read: (as: string) => tower.call<{ id: string }>(as, sql`select id from workflow_binding where id = ${binding}::uuid`),
      target: binding,
      seenBy: [c1.ap, c2.members.engineer],
      hiddenFrom: [c1.members.engineer, k1.members.engineer, k1.ap],
      name: named,
      label: "C2's exception binding",
    });
  });
});
