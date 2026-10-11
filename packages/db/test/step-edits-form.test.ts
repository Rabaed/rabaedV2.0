// Seam 2: app.step_edits_form, whether the raiser's Form is edited at a Step (ADR 0019,
// RP-514), against @rabaed/domain's stepEditsForm over the shared cases
// (packages/domain/src/step-edits-form-cases.json; CODING_STANDARDS, Tests: a rule
// enforced in SQL and in TypeScript is tested against the same cases).
import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseUrls } from "../test-support/index.ts";

type Case = {
  name: string;
  steps: { key: string; stage: string; actor: { role: string; permission: string } | null; editsForm?: boolean }[];
  step: string;
  editsForm: boolean;
};
const cases = JSON.parse(readFileSync(new URL("../../domain/src/step-edits-form-cases.json", import.meta.url), "utf8")) as Case[];

let migrator: pg.Client;
beforeAll(async () => {
  migrator = new pg.Client({ connectionString: testDatabaseUrls().migrator });
  await migrator.connect();
});
afterAll(() => migrator?.end());

/** The case's Steps as a draft Version of a new Rabaed Default Workflow; the id of its Step `key`. */
async function stepOf({ steps, step }: Case): Promise<string> {
  const { rows } = await migrator.query<{ id: string }>(
    `with definition as (
       insert into workflow_definition (owner_kind, name) values ('rabaed', '{"en": "Step edits Form (test)", "ar": "تعديل النموذج"}') returning id
     ), version as (
       insert into workflow_version (workflow_definition_id, version_no, status) select id, 1, 'draft' from definition returning id
     )
     insert into workflow_step (workflow_version_id, key, name, stage_key, actor_rule, outcome_mode, edits_form)
     select version.id, s ->> 'key', jsonb_build_object('en', s ->> 'key', 'ar', s ->> 'key'), s ->> 'stage',
       case when s -> 'actor' = 'null' then '{}'::jsonb
         else jsonb_build_object('base_role', s -> 'actor' ->> 'role', 'permission', s -> 'actor' ->> 'permission') end,
       'none', (s ->> 'editsForm')::boolean
     from version, jsonb_array_elements($1::jsonb) s
     returning id, key`,
    [JSON.stringify(steps)],
  );
  return (rows as unknown as { id: string; key: string }[]).find((r) => r.key === step)!.id;
}

describe("app.step_edits_form, over the cases @rabaed/domain's stepEditsForm shares", () => {
  it.each(cases)("$name", async (c) => {
    const id = await stepOf(c);
    const { rows } = await migrator.query<{ edits: boolean }>("select app.step_edits_form($1) as edits", [id]);
    expect(rows[0]!.edits).toBe(c.editsForm);
  });
});
