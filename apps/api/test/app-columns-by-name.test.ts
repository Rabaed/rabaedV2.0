// Seam 1 for RP-998: the api reads an app.* function's result by column name,
// never by position. app.work_item_actions keeps gaining columns (RP-658 added
// `picks_participant`); a read that renamed its columns in order would, after a
// column added mid-list, take each value after it from its neighbour, with no
// error. Here the function gains a column in the middle of its result, and the
// item's page, the Kanban's moves and the Package's bulk offers still read the
// same Transitions. scripts/check-app-columns.test.ts keeps new code from
// reading by position again.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { workItemSearchParams, type PackageDetail, type WorkItemBoard } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi } from "./support/harness.ts";
import { bilingual, buildTower, detail, inInternalReview, ok, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });

/** The real function, renamed while the test's version with one more column stands in for it. */
const REAL = "work_item_actions_before_rp998";

/** Puts the real app.work_item_actions back; a no-op when it is in place (also after a run that stopped half-way). */
async function restore() {
  await sql`
    do $$
      begin
        if to_regprocedure(${sql.lit(`app.${REAL}(uuid)`)}) is not null then
          drop function if exists app.work_item_actions(uuid);
          alter function app.${sql.raw(REAL)}(uuid) rename to work_item_actions;
        end if;
      end
    $$
  `.execute(migrator);
}

/** app.work_item_actions with a column, `inserted`, in the middle of its result: after `action`, before `transition_key`. */
async function insertColumnMidList() {
  await sql`
    do $$
      begin
        alter function app.work_item_actions(uuid) rename to ${sql.raw(REAL)};
        create function app.work_item_actions(p_work_item_id uuid)
          returns table(action text, inserted text, transition_key text, label jsonb, transition_kind text, picks_participant boolean)
          language sql stable set search_path = pg_catalog, public
          as 'select a.action, ''inserted'', a.transition_key, a.label, a.transition_kind, a.picks_participant from app.${sql.raw(REAL)}($1) a';
        revoke all on function app.work_item_actions(uuid) from public;
        grant execute on function app.work_item_actions(uuid) to rabaed_app;
      end
    $$
  `.execute(migrator);
}

afterAll(async () => {
  await restore();
  await api.close();
  await migrator.destroy();
});

let at: Tower;
let item = "";
let packageId = "";

/** What C1's PM reads of the item's Transitions: on its page, as the Kanban's moves and as the Package's bulk offers. */
async function reads() {
  const page = (await detail(at.c1Pm, item)).actions.transitions.map((t) => ({ key: t.key, label: t.label, kind: t.kind }));
  const board: WorkItemBoard = (await ok(at.c1Pm.get(`/v1/projects/${at.projectId}/work-items/kanban?${workItemSearchParams({})}`), 200)).json();
  const moves = (board.moves[item] ?? []).map((m) => ({ key: m.transition, label: m.label, kind: m.kind, stageKey: m.stageKey }));
  const pkg: PackageDetail = (await ok(at.c1Pm.get(`/v1/packages/${packageId}`), 200)).json();
  const offers = (pkg.items.find((i) => i.id === item)?.bulkTransitions ?? []).map((o) => ({ key: o.key, label: o.label }));
  return { page, moves, offers };
}

let before: Awaited<ReturnType<typeof reads>>;

beforeAll(async () => {
  await restore();
  const c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "TCN");
  // In C1's internal review, picked up by its PM, in a Package: waiting on the PM, who may Submit it.
  item = await inInternalReview(at, at.c1Engineer, "Cable ladders");
  await ok(at.c1Pm.post(`/v1/work-items/${item}/pick-up`));
  packageId = (await ok(at.c1Pm.post(`/v1/projects/${at.projectId}/packages`, { name: bilingual("Ladders") }), 201)).json().id;
  await ok(at.c1Pm.post(`/v1/packages/${packageId}/items`, { workItemId: item }));
  before = await reads();
  await insertColumnMidList();
});

describe("app.work_item_actions gains a column in the middle of its result", () => {
  it("the item's page, the Kanban's moves and the Package's bulk offers read the same Transitions as before", async () => {
    const submit = { key: "submit", label: { en: "Submit", ar: expect.any(String) }, kind: "submit" };
    expect(before.page).toContainEqual(submit);
    expect(before.moves).toContainEqual({ ...submit, stageKey: expect.any(String) });
    expect(before.offers).toContainEqual({ key: submit.key, label: submit.label });

    expect(await reads()).toEqual(before);
  });
});
