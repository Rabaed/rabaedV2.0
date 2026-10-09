// Seam 2 for outcome sets (RP-429, WF-6; data-model.md outcome). Each Work Item
// Type has its own set; a Project runs its own copy of each Rabaed Default Type's
// set, seeded like its Stages; its Project Admin adds outcomes and changes their
// names, follow-up actions and order there, each audited in project_event, and the
// Rabaed Defaults never change. Outcomes are read like their Type: every Member of
// the Project reads its copy (project-rls.test.ts checks the table among every
// Project table), and the app role writes none directly.
import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { defaultOutcomeSets, outcomeKinds, type Outcome } from "@rabaed/domain";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

type OutcomeCases = { codes: { code: string; valid: boolean }[]; actions: { name: string; actions: unknown; valid: boolean }[] };
const cases = JSON.parse(readFileSync(new URL("../../domain/src/outcome-cases.json", import.meta.url), "utf8")) as OutcomeCases;

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;

let migrator: pg.Client;
let app: Db;
let creator = "";
let colleague = "";
let projectId = "";
let otherProjectId = "";

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

const createProject = (who: string, code: string) =>
  withMember(app, who, (trx) =>
    sql<{ project_id: string }>`select project_id from app.create_project('{"en": "P", "ar": "م"}'::jsonb, ${code}, 'contractor')`
      .execute(trx)
      .then((r) => r.rows[0]!.project_id),
  );

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  const companyId = await one(
    "insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id",
    [JSON.stringify({ en: "S", ar: "س" }), digits(10), `3${digits(13)}3`, engineer],
  );
  const member = (who: string, canCreate: boolean) =>
    one("insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', $4) returning id", [
      companyId,
      email(who),
      JSON.stringify({ en: who, ar: who }),
      canCreate,
    ]);
  creator = await member("creator", true);
  colleague = await member("colleague", false);
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [creator, companyId]);
  projectId = await createProject(creator, "OUT");
  otherProjectId = await createProject(creator, "OTH");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

type Row = Pick<Outcome, "code" | "name" | "closing" | "polarity" | "actions">;
const columns = "code, name, closing, polarity, actions";

/** A Type's set: the Rabaed Default one (`project` null) or a Project's copy, in order. */
const setOf = async (project: string | null, type = "MAR") =>
  (
    await migrator.query<Row>(
      `select ${columns} from outcome
       where work_item_type_id = (select id from work_item_type where code = $2 and project_id is null)
         and project_id is not distinct from $1
       order by sort, code`,
      [project, type],
    )
  ).rows;

const outcomeAs = (memberId: string, query: ReturnType<typeof sql<{ outcome: string }>>) =>
  withMember(app, memberId, (trx) => query.execute(trx)).then((r) => r.rows[0]!.outcome);

const e = { en: "Approved for construction only", ar: "معتمد للتنفيذ فقط" };
const addE = (who: string, project = projectId, code = "E") =>
  outcomeAs(
    who,
    sql`select app.add_outcome(${project}::uuid, 'MAR', ${code}, ${JSON.stringify(e)}::jsonb, true, 'positive', '[]'::jsonb) as outcome`,
  );

describe("the Rabaed Default sets", () => {
  it("are the domain's, kind by kind", async () => {
    for (const kind of outcomeKinds) {
      const { rows } = await migrator.query<Row>(`select ${columns} from app.default_outcomes($1)`, [kind]);
      expect(rows, kind).toEqual(defaultOutcomeSets[kind]);
    }
  });

  it("are the MAR's: Review Codes A to D", async () => {
    expect(await setOf(null)).toEqual(defaultOutcomeSets.review_code);
  });

  it("are given to a new Rabaed Default Type, by its outcome kind, and copied into every Project", async () => {
    await migrator.query("begin");
    try {
      await migrator.query(
        `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
         select 'rabaed', 'inspections', 'PROBE', '{"en": "Probe", "ar": "تجربة"}', workflow_definition_id, 'inspection_result', form_definition_id
         from work_item_type where code = 'MAR' and project_id is null`,
      );
      expect(await setOf(null, "PROBE")).toEqual(defaultOutcomeSets.inspection_result);
      expect(await setOf(projectId, "PROBE")).toEqual(defaultOutcomeSets.inspection_result);
    } finally {
      await migrator.query("rollback");
    }
  });
});

describe("a Project's copy", () => {
  it("is the Rabaed Default set, when the Project is created", async () => {
    expect(await setOf(otherProjectId)).toEqual(defaultOutcomeSets.review_code);
  });

  it("gains an outcome its Project Admin adds, last, audited, and no other Project's or the Rabaed Default's does", async () => {
    expect(await addE(creator)).toBe("added");
    expect(await setOf(projectId)).toEqual([...defaultOutcomeSets.review_code, { code: "E", name: e, closing: true, polarity: "positive", actions: [] }]);
    expect(await setOf(otherProjectId)).toEqual(defaultOutcomeSets.review_code);
    expect(await setOf(null)).toEqual(defaultOutcomeSets.review_code);
    const { rows } = await migrator.query("select type, actor_member_id, payload from project_event where project_id = $1 and type = 'outcome_added'", [
      projectId,
    ]);
    expect(rows).toEqual([
      {
        type: "outcome_added",
        actor_member_id: creator,
        payload: { type: "MAR", code: "E", name: e, closing: true, polarity: "positive", actions: [] },
      },
    ]);
    expect(await addE(creator)).toBe("outcome_exists");
  });

  it("refuses an outcome a set can't hold", async () => {
    const add = (code: string, name: unknown, polarity: string, actions: unknown) =>
      outcomeAs(
        creator,
        sql`select app.add_outcome(${projectId}::uuid, 'MAR', ${code}, ${JSON.stringify(name)}::jsonb, true, ${polarity}, ${JSON.stringify(actions)}::jsonb) as outcome`,
      );
    expect(await add("cancelled", e, "positive", [])).toBe("invalid_outcome");
    expect(await add("1X", e, "positive", [])).toBe("invalid_outcome");
    expect(await add("F", { en: "Only English" }, "positive", [])).toBe("invalid_outcome");
    expect(await add("F", e, "neutral", [])).toBe("invalid_outcome");
    expect(await add("F", e, "positive", [{ kind: "offer_revision" }, { kind: "offer_revision" }])).toBe("invalid_outcome");
    expect(await add("F", e, "positive", [{ kind: "create_items", type: "comments" }])).toBe("invalid_outcome");
    expect(await add("F", e, "positive", [{ kind: "notify" }])).toBe("invalid_outcome");
  });

  it("changes an outcome's names and follow-up actions, audited; its code, closing and polarity stay", async () => {
    const renamed = { en: "Approved, shop drawings to follow", ar: "معتمد، المخططات التنفيذية لاحقاً" };
    expect(
      await outcomeAs(
        creator,
        sql`select app.change_outcome(${projectId}::uuid, 'MAR', 'B', ${JSON.stringify(renamed)}::jsonb, '[{"kind": "offer_revision"}]'::jsonb) as outcome`,
      ),
    ).toBe("changed");
    const b = (await setOf(projectId)).find((o) => o.code === "B");
    expect(b).toEqual({ code: "B", name: renamed, closing: true, polarity: "positive", actions: [{ kind: "offer_revision" }] });
    expect((await setOf(null)).find((o) => o.code === "B")).toEqual(defaultOutcomeSets.review_code[1]);
    const { rows } = await migrator.query("select payload from project_event where project_id = $1 and type = 'outcome_changed'", [projectId]);
    expect(rows).toEqual([
      {
        payload: {
          type: "MAR",
          code: "B",
          from: { name: defaultOutcomeSets.review_code[1]!.name, actions: [{ kind: "create_items", type: "CMT" }] },
          to: { name: renamed, actions: [{ kind: "offer_revision" }] },
        },
      },
    ]);
    expect(
      await outcomeAs(creator, sql`select app.change_outcome(${projectId}::uuid, 'MAR', 'Z', ${JSON.stringify(renamed)}::jsonb, '[]'::jsonb) as outcome`),
    ).toBe("not_found");
  });

  it("is put in a new order, every code once", async () => {
    const codes = (await setOf(projectId)).map((o) => o.code);
    const reversed = codes.toReversed();
    expect(await outcomeAs(creator, sql`select app.reorder_outcomes(${projectId}::uuid, 'MAR', ${reversed}::text[]) as outcome`)).toBe("reordered");
    expect((await setOf(projectId)).map((o) => o.code)).toEqual(reversed);
    expect(await outcomeAs(creator, sql`select app.reorder_outcomes(${projectId}::uuid, 'MAR', ${["A"]}::text[]) as outcome`)).toBe("invalid_order");
    expect(await outcomeAs(creator, sql`select app.reorder_outcomes(${projectId}::uuid, 'MAR', ${codes}::text[]) as outcome`)).toBe("reordered");
  });
});

describe("an outcome's code, closing and polarity (decided 2026-10-09)", () => {
  let project = "";
  const change = (code: string, newCode: string | null, closing: boolean | null, polarity: string | null, name = e) =>
    outcomeAs(
      creator,
      sql`select app.change_outcome(${project}::uuid, 'MAR', ${code}, ${JSON.stringify(name)}::jsonb, '[]'::jsonb,
        ${newCode}, ${closing}, ${polarity}) as outcome`,
    );

  beforeAll(async () => {
    project = await createProject(creator, "OUD");
  });

  it("change while unused, audited", async () => {
    expect(await addE(creator, project, "F")).toBe("added");
    expect(await change("F", "F2", false, "negative")).toBe("changed");
    expect((await setOf(project)).find((o) => o.code === "F2")).toEqual({ code: "F2", name: e, closing: false, polarity: "negative", actions: [] });
    expect((await setOf(project)).find((o) => o.code === "F")).toBeUndefined();
    const { rows } = await migrator.query("select payload from project_event where project_id = $1 and type = 'outcome_changed'", [project]);
    expect(rows).toEqual([
      {
        payload: {
          type: "MAR",
          code: "F",
          from: { name: e, actions: [], code: "F", closing: true, polarity: "positive" },
          to: { name: e, actions: [], code: "F2", closing: false, polarity: "negative" },
        },
      },
    ]);
    // A code the set has, or one it can't hold.
    expect(await change("F2", "A", null, null)).toBe("outcome_exists");
    expect(await change("F2", "pending", null, null)).toBe("invalid_outcome");
    expect(await change("F2", null, null, "neutral")).toBe("invalid_outcome");
  });

  it("stay once a Workflow the Project can use names the outcome: a Rabaed Default's", async () => {
    const before = await setOf(project);
    expect(await change("A", null, false, null)).toBe("outcome_in_use");
    expect(await change("A", "AA", null, null)).toBe("outcome_in_use");
    expect(await change("A", null, null, "negative")).toBe("outcome_in_use");
    expect(await setOf(project)).toEqual(before);
    // Its name may still change, the other three given as they are.
    expect(await change("A", "A", true, "positive", { en: "Approved as submitted", ar: "معتمد كما قُدّم" })).toBe("changed");
  });

  it("stay once the Project's own published Workflow names it", async () => {
    expect(await addE(creator, project, "G")).toBe("added");
    expect(await change("G", null, null, "negative")).toBe("changed");
    await migrator.query(
      `with type as (select id from work_item_type where code = 'MAR' and project_id is null),
      definition as (
        insert into workflow_definition (owner_kind, project_id, name, work_item_type_id)
        select 'project', $1, '{"en": "Closes with G (test)", "ar": "يغلق بـ G"}', id from type returning id
      ), version as (
        insert into workflow_version (workflow_definition_id, version_no, status) select id, 1, 'draft' from definition returning id
      ), steps as (
        insert into workflow_step (workflow_version_id, key, name, stage_key, actor_rule, outcome_mode)
        select version.id, s.key, '{"en": "S", "ar": "س"}', s.stage_key, s.actor_rule::jsonb, 'none'
        from version, (values ('draft', 'draft', '{"base_role": "contractor", "permission": "create"}'), ('done', 'approved', '{}'))
          as s (key, stage_key, actor_rule)
        returning id, key, workflow_version_id
      )
      insert into workflow_transition (workflow_version_id, key, from_step_id, to_step_id, label, kind, outcome, permission, sort)
      select f.workflow_version_id, 'close_g', f.id, t.id, '{"en": "G", "ar": "G"}', 'close', 'G', 'create', 1
      from steps f, steps t where f.key = 'draft' and t.key = 'done'`,
      [project],
    );
    expect(await change("G", null, null, "positive")).toBe("changed");
    await migrator.query(
      `update workflow_version set status = 'published', published_at = now()
       where workflow_definition_id = (select id from workflow_definition where project_id = $1 and name ->> 'en' = 'Closes with G (test)')`,
      [project],
    );
    expect(await change("G", null, null, "negative")).toBe("outcome_in_use");
    expect(await change("G", null, false, null)).toBe("outcome_in_use");
  });
});

describe("who changes a set", () => {
  it("answers not_found to a Member who isn't the Project's Admin, and to a Type the Project doesn't use", async () => {
    const before = await setOf(otherProjectId);
    expect(await addE(colleague, otherProjectId)).toBe("not_found");
    expect(
      await outcomeAs(creator, sql`select app.add_outcome(${otherProjectId}::uuid, 'NOPE', 'E', ${JSON.stringify(e)}::jsonb, true, 'positive', '[]') as outcome`),
    ).toBe("not_found");
    expect(await setOf(otherProjectId)).toEqual(before);
  });

  it("can't be written around: the app role writes no outcome directly", async () => {
    await expect(
      withMember(app, creator, (trx) => sql`update outcome set polarity = 'negative' where project_id = ${projectId}::uuid`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withMember(app, creator, (trx) =>
        sql`insert into outcome (owner_kind, project_id, work_item_type_id, code, name, closing, polarity, sort)
            select 'project', ${projectId}::uuid, work_item_type_id, 'X', name, closing, polarity, 9 from outcome limit 1`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("is read by every Member of the Project, and the Rabaed Defaults by every Member", async () => {
    const read = (who: string, project: string | null) =>
      withMember(app, who, (trx) =>
        sql<{ n: number }>`select count(*)::int as n from outcome where project_id is not distinct from ${project}::uuid`.execute(trx),
      ).then((r) => r.rows[0]!.n);
    expect(await read(creator, projectId)).toBeGreaterThan(0);
    expect(await read(colleague, projectId)).toBe(0);
    expect(await read(colleague, null)).toBeGreaterThan(0);
  });
});

// The same rule as @rabaed/domain's outcomeCode and outcomeActions, over the same cases.
describe("app.is_outcome_code, the cases shared with @rabaed/domain", () => {
  it.each(cases.codes)("$code: $valid", async ({ code, valid }) => {
    const { rows } = await migrator.query<{ valid: boolean }>("select app.is_outcome_code($1) as valid", [code]);
    expect(rows[0]!.valid).toBe(valid);
  });
});

describe("app.is_outcome_actions, the cases shared with @rabaed/domain", () => {
  it.each(cases.actions)("$name: $valid", async ({ actions, valid }) => {
    const { rows } = await migrator.query<{ valid: boolean }>("select app.is_outcome_actions($1::jsonb) as valid", [JSON.stringify(actions)]);
    expect(rows[0]!.valid).toBe(valid);
  });
});
