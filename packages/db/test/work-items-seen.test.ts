// Seam 2 for app.work_items_seen (RP-1050): the work item query's rows, each item checked once, must say for every
// item exactly what the per-item functions say, as the app role, for every active Member of every Project in the
// database (the seeded demo, and whatever the suite has made before this file). It answers for many items at once,
// so it reads the latest Revision, Code C, whether the reader's Participant holds the item, its Trade and Location
// as seen and its Companies' names in sets; this keeps each of those in step with its own function.
import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { createDb, withMember } from "../src/index.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const migrator = createDb(urls.migrator, { max: 1 });
const app = createDb(urls.app, { max: 2 });
afterAll(async () => {
  await migrator.destroy();
  await app.destroy();
});

/** Every active Member on a Project with items, with the Project and its Modules. */
async function readers() {
  const { rows } = await sql<{ member_id: string; project_id: string; modules: string[] }>`
    select distinct pm.member_id, pm.project_id,
      array(select distinct t.module_key from work_item w join work_item_type t on t.id = w.work_item_type_id where w.project_id = pm.project_id) as modules
    from project_member pm
    where pm.status = 'active' and exists (select 1 from work_item w where w.project_id = pm.project_id)
    order by pm.project_id, pm.member_id
  `.execute(migrator);
  return rows;
}

/**
 * What app.work_items_seen says of each item and what the per-item functions say, side by side, for the items
 * where they differ; and the items one gives and the other doesn't.
 */
const differences = (projectId: string, modules: string[], allRevisions: boolean) => sql<{ id: string; batch: unknown; helpers: unknown }>`
  with batch as (
    select b.id, jsonb_build_object(
      'step', b.step_id, 'stage', b.stage_key, 'entered', b.entered_at,
      'holder', b.holder_participant_id, 'holder_member', b.holder_member_id,
      'owner_review', b.owner_review, 'code_c', b.had_code_c, 'created', b.creation_date,
      'values', (select jsonb_agg(jsonb_build_array(d, v) order by d, v) from unnest(b.dimension_ids, b.dimension_value_ids) x (d, v)),
      'holder_name', b.holder_company_name, 'raiser_name', b.raiser_company_name) as says
    from app.work_items_seen(${projectId}::uuid, ${modules}::text[], ${allRevisions}::boolean) b
    -- The work item query joins the Step through its own row-level security, as the per-item side below does: an item
    -- at a Step of a Workflow Version the reader may not read (another test's unpublished one) is listed by neither.
    join workflow_step ws on ws.id = b.step_id
  ), helpers as (
    select w.id, jsonb_build_object(
      'step', seen.step_id, 'stage', seen.stage_key, 'entered', seen.entered_at,
      'holder', h.participant_id, 'holder_member', h.assignee_member_id,
      'owner_review', case when s.outcome_mode = 'confirm_code' then app.with_owner_review(w.id) end,
      'code_c', exists (
        select 1 from app.revision_chain(w.id) rc join work_item o on o.id = rc.work_item_id
        where app.outcome_offers(o.project_id, o.work_item_type_id, o.outcome, 'offer_revision')),
      'created', app.work_item_creation_date(w.id),
      'values', (select jsonb_agg(jsonb_build_array(dv.dimension_id, dv.dimension_value_id) order by dv.dimension_id, dv.dimension_value_id)
        from work_item_dimension_value_seen dv where dv.work_item_id = w.id),
      'holder_name', (select c.legal_name from app.work_item_companies(w.id) c where c.participant_id = h.participant_id),
      'raiser_name', (select c.legal_name from app.work_item_companies(w.id) c where c.participant_id = w.raised_by_participant_id)) as says
    from work_item w
    join work_item_type t on t.id = w.work_item_type_id
    cross join lateral app.step_as_seen(w.id) seen
    join workflow_step s on s.id = seen.step_id
    left join lateral (select * from app.work_item_holder(w.id) limit 1) h on true
    where w.project_id = ${projectId}::uuid and t.module_key = any(${modules}::text[])
      and (${allRevisions}::boolean or app.latest_visible_revision(w.id))
  )
  select coalesce(b.id, h.id) as id, b.says as batch, h.says as helpers
  from batch b full join helpers h on h.id = b.id
  where b.says is distinct from h.says
`;

describe("app.work_items_seen", () => {
  it("says of every item what the per-item functions say, for every Member of every Project", async () => {
    const all = await readers();
    expect(all.length).toBeGreaterThan(0);
    let items = 0;
    for (const { member_id, project_id, modules } of all) {
      for (const allRevisions of [false, true]) {
        const found = await withMember(app, member_id, async (trx) => {
          const { rows } = await differences(project_id, modules, allRevisions).execute(trx);
          const { rows: seen } = await sql<{ n: number }>`
            select count(*)::int as n from app.work_items_seen(${project_id}::uuid, ${modules}::text[], ${allRevisions}::boolean)
          `.execute(trx);
          items += seen[0]!.n;
          return rows;
        });
        // On a difference, each item's Revision chain as it is, to tell why.
        const chains =
          found.length === 0
            ? []
            : (
                await sql<Record<string, unknown>>`
                  select w.id, w.root_id, w.revision_no, w.discarded_at, w.document_number, w.current_step_id, w.closed_at, t.module_key
                  from work_item o join work_item w on w.root_id = o.root_id join work_item_type t on t.id = w.work_item_type_id
                  where o.id = any(${found.map((f) => f.id)}::uuid[]) order by w.root_id, w.revision_no
                `.execute(migrator)
              ).rows;
        expect({ member_id, project_id, allRevisions, found, chains }).toEqual({ member_id, project_id, allRevisions, found: [], chains: [] });
      }
    }
    // Not vacuous: the Members saw items between them.
    expect(items).toBeGreaterThan(0);
  });

  it("gives only the items asked for, as for the whole scope", async () => {
    for (const { member_id, project_id, modules } of (await readers()).slice(0, 20)) {
      await withMember(app, member_id, async (trx) => {
        const { rows: whole } = await sql<{ id: string; says: unknown }>`
          select b.id, to_jsonb(b) as says from app.work_items_seen(${project_id}::uuid, ${modules}::text[], true) b order by b.id
        `.execute(trx);
        const ids = whole.filter((_, i) => i % 2 === 0).map((r) => r.id);
        const { rows: some } = await sql<{ id: string; says: unknown }>`
          select b.id, to_jsonb(b) as says from app.work_items_seen(${project_id}::uuid, ${modules}::text[], true, ${ids}::uuid[]) b order by b.id
        `.execute(trx);
        expect(some).toEqual(whole.filter((r) => ids.includes(r.id)));
      });
    }
  });
});
