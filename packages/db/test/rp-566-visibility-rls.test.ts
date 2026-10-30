// Seam 2 for what a Rabaed Default Version a Project lacks an outcome of tells whom (RP-566;
// workflow-engine.md "Rabaed Admin -> Workflows"; visibility.md V9; scenario RP-566-1). The publish
// (writeRabaedDefaultWorkflow, as Rabaed Admin and the CLI run it with the migrator's credentials) is
// refused `projects_lack_entries` with how many Projects and which outcomes, never which Project, and
// the app role can't run it at all. A Project Admin's binding back onto that Rabaed Default
// (app.bind_workflow, app.unbind_workflow) is refused `default_lacks_entries`, and
// app.binding_lacks_entries names the Project's own missing outcomes to its Project Admins only.
// Once the Project Admin adds the outcome, the binding goes and the Project's new items start on the
// Rabaed Default with no outcome outside its set. A test Rabaed Type of its own (MAR's shape).
// Seam 1: apps/api/test/rp-566-visibility.test.ts.
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, readLatestPublishedDefinition, withMember, writeRabaedDefaultWorkflow, type Db } from "../src/index.ts";
import type { WorkflowDefinition } from "@rabaed/domain";
import { bilingual, buildSeamTwoTower, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const TYPE = "RLW";
const code = `W${Math.random().toString(36).slice(2, 7)}`;

let migrator: pg.Client;
let owner: Db; // The migrator, as Kysely: Rabaed Admin's and the CLI's credentials.
let app: Db;
const towerOptions = { projectCode: "RLW", otherProject: true } as const;
let tower: SeamTwoTower<typeof towerOptions>;
let typeId = "";
let defaultId = "";
let copyId = "";
let withCode: WorkflowDefinition;
const names = new Map<string, string>();
const named = (as: string) => names.get(as) ?? as;
const latestVersionNo = async () => (await readLatestPublishedDefinition(owner, defaultId))!.versionNo;

/** `as` runs `query` selecting one `outcome`. */
const outcomeOf = (as: string, query: ReturnType<typeof sql<{ outcome: string }>>) => tower.outcome(as, query);
const bind = (as: string, participantId: string | null) =>
  outcomeOf(as, sql`select app.bind_workflow(${tower.projectId}::uuid, ${typeId}::uuid, ${participantId}::uuid, ${defaultId}::uuid, now()) as outcome`);
const unbind = (as: string, participantId: string | null) =>
  outcomeOf(as, sql`select app.unbind_workflow(${tower.projectId}::uuid, ${typeId}::uuid, ${participantId}::uuid, now()) as outcome`);
/** The outcomes `as` is told the Tower lacks to fall back to the Rabaed Default Project-wide, one row each. */
const toldLacking = async (as: string) =>
  (
    await tower.call<{ outcomes: string[] }>(as, sql`select outcomes from app.binding_lacks_entries(${tower.projectId}::uuid, ${typeId}::uuid, null, null)`)
  ).flatMap((r) => r.outcomes.map((outcome) => ({ id: outcome })));

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  owner = createDb(urls.migrator, { max: 1 });
  app = createDb(urls.app, { max: 2 });

  // The Type's Rabaed Default, published with MAR's definition.
  defaultId = (await migrator.query("insert into workflow_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Lacking (RP-566-1, seam 2)"))]))
    .rows[0].id as string;
  typeId = (
    await migrator.query(
      `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
       select 'rabaed', m.module_key, $1, $2, $3, m.outcome_kind, m.form_definition_id
       from work_item_type m where m.owner_kind = 'rabaed' and m.code = 'MAR' returning id`,
      [TYPE, JSON.stringify(bilingual("Lacking (RP-566-1, seam 2)")), defaultId],
    )
  ).rows[0].id as string;
  const marWorkflowId = (await migrator.query("select workflow_definition_id as id from work_item_type where owner_kind = 'rabaed' and code = 'MAR'")).rows[0].id as string;
  const mar = (await readLatestPublishedDefinition(owner, marWorkflowId))!;
  expect(await writeRabaedDefaultWorkflow(owner, TYPE, mar.definition, { publish: true })).toMatchObject({ ok: true });
  const a = mar.definition.transitions.find((tr) => tr.key === "approve_a")!;
  withCode = { ...mar.definition, transitions: [...mar.definition.transitions, { ...a, key: "approve_w", label: bilingual(`Approve · ${code}`), outcome: code }] };

  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  const { c1, k1, c2, other } = tower;
  for (const [as, name] of [
    [c1.ap, "the Tower's Project Admin"],
    [c1.members.engineer, "a plain Tower Member"],
    [k1.ap, "K1's Authorized Person"],
    [c2.ap, "C2's Authorized Person"],
    [other.ap, "another Project's Admin"],
  ] as const)
    names.set(as, name);

  // The Tower runs its own copy Project-wide; an exception keeps C2 on the Rabaed Default.
  const [copy] = await tower.call<{ outcome: string; workflow_definition_id: string }>(
    c1.ap,
    sql`select outcome, workflow_definition_id from app.duplicate_workflow(${defaultId}::uuid, ${tower.projectId}::uuid, ${JSON.stringify(bilingual("Tower's own"))}::jsonb, now())`,
  );
  expect(copy!.outcome).toBe("duplicated");
  copyId = copy!.workflow_definition_id;
  expect((await tower.call<{ outcome: string }>(c1.ap, sql`select outcome from app.publish_workflow(${copyId}::uuid, now())`))[0]!.outcome).toBe("published");
  expect(await outcomeOf(c1.ap, sql`select app.bind_workflow(${tower.projectId}::uuid, ${typeId}::uuid, null, ${copyId}::uuid, now()) as outcome`)).toBe("bound");
  expect(await bind(c1.ap, c2.participantId)).toBe("bound");

  // Rabaed adds an outcome to the Type's set: every Project but the Tower already holds it.
  await migrator.query(
    `insert into outcome (owner_kind, project_id, work_item_type_id, code, name, closing, polarity, actions, sort)
     values ('rabaed', null, $1, $2, $3, true, 'positive', '[]'::jsonb, 99)`,
    [typeId, code, JSON.stringify(bilingual("On site"))],
  );
  await migrator.query(
    `insert into outcome (owner_kind, project_id, work_item_type_id, code, name, closing, polarity, actions, sort)
     select 'project', p.id, $1, $2, $3, true, 'positive', '[]'::jsonb, 99 from project p
     where p.id <> $4 and not exists (select 1 from outcome o where o.project_id = p.id and o.work_item_type_id = $1 and o.code = $2)`,
    [typeId, code, JSON.stringify(bilingual("On site")), tower.projectId],
  );
});

afterAll(async () => {
  await app?.destroy();
  await owner?.destroy();
  await migrator?.end();
});

describe("scenario RP-566-1: a Rabaed Default Version that uses an outcome the Tower lacks", () => {
  it("is refused while C2's exception keeps C2 on the Rabaed Default, with the count and the outcomes only, and nothing is published", async () => {
    const before = await latestVersionNo();
    expect(await writeRabaedDefaultWorkflow(owner, TYPE, withCode, { publish: true })).toEqual({ ok: false, reason: "projects_lack_entries", projects: 1, outcomes: [code], stages: [] });
    expect(await latestVersionNo()).toBe(before);
  });

  it("can't be published by the app role, whoever the Member", async () => {
    const before = await latestVersionNo();
    await expect(withMember(app, tower.c1.ap, (trx) => writeRabaedDefaultWorkflow(trx, TYPE, withCode, { publish: true }))).rejects.toMatchObject({ code: "42501" });
    expect(await latestVersionNo()).toBe(before);
  });

  it("publishes once the Project Admin removes C2's exception, so the Tower runs the Default no more", async () => {
    const before = await latestVersionNo();
    expect(await unbind(tower.c1.ap, tower.c2.participantId)).toBe("unbound");
    expect(await writeRabaedDefaultWorkflow(owner, TYPE, withCode, { publish: true })).toMatchObject({ ok: true, versionNo: before + 1 });
  });

  it("refuses putting the Tower or C2 back on it, and names the Tower's own missing outcome to its Project Admin only", async () => {
    const { c1, k1, c2, other } = tower;
    expect(await bind(c1.ap, c2.participantId)).toBe("default_lacks_entries");
    expect(await bind(c1.ap, null)).toBe("default_lacks_entries");
    expect(await unbind(c1.ap, null)).toBe("default_lacks_entries");
    await expectHiddenFrom({
      read: toldLacking,
      target: code,
      seenBy: c1.ap,
      hiddenFrom: [c1.members.engineer, k1.ap, c2.ap, other.ap],
      name: named,
      label: "the outcome the Tower lacks",
    });
    // Anyone but its Project Admin is refused as for a Project they don't run, and learns nothing of the lack.
    for (const as of [c1.members.engineer, k1.ap, other.ap]) expect(await unbind(as, null), named(as)).toBe("not_found");
    const [binding] = await tower.call<{ id: string }>(
      c1.ap,
      sql`select workflow_definition_id as id from workflow_binding where project_id = ${tower.projectId}::uuid and work_item_type_id = ${typeId}::uuid and raising_participant_id is null`,
    );
    expect(binding?.id).toBe(copyId);
  });

  it("goes back once the Project Admin adds the outcome, and the Tower's new items start on a Version with no outcome outside its set", async () => {
    const { c1 } = tower;
    expect(
      await outcomeOf(c1.ap, sql`select app.add_outcome(${tower.projectId}::uuid, ${TYPE}, ${code}, ${JSON.stringify(bilingual("On site"))}::jsonb, true, 'positive', '[]'::jsonb) as outcome`),
    ).toBe("added");
    expect(await unbind(c1.ap, null)).toBe("unbound");
    const { rows } = await migrator.query(
      `with v as (select app.new_item_workflow_version($1, $2, null) as id)
       select (select version_no from workflow_version where id = v.id) as version_no,
         array(select t.outcome from workflow_transition t where t.workflow_version_id = v.id and t.outcome is not null
           and not exists (select 1 from outcome o where o.project_id = $1 and o.work_item_type_id = $2 and o.code = t.outcome and o.closing)) as outside
       from v`,
      [tower.projectId, typeId],
    );
    expect(rows).toEqual([{ version_no: await latestVersionNo(), outside: [] }]);
  });
});
