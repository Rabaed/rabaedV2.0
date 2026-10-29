// Seam 2 for four Inspections scenarios that seam 1 covered alone (RP-1082, from the epic review RP-676 of
// spec RP-649; visibility.md V3, V5 and the rows RP-652-1, RP-656-1, RP-170-1, RP-673-1), as the app role:
//
// * RP-652-1: with "Show Inspections in the Submittals tab" on, the Submittals tab reads both Modules through
//   app.work_items_seen. That widens where a viewer's own rows show, never which rows: each viewer reads exactly
//   the union of what each Module gives them, a WIR in a Submittals Stage key; C2 reads none of C1's WIR.
// * RP-656-1: an annotated photo on a MAR is read exactly where its original is: by C1 and K1, linked to the
//   untouched original; C2 reads neither row and can't annotate it.
// * RP-170-1 and RP-673-1: the real WIR Workflow Versions 2 (Recommended Result) and 3 (Recommended Code), pinned
//   as items started on them are. The Recommended Code or Result and its Internal Note are internal to K1; C1 and the Owner
//   read none of it before or after the outcome; C2 reads no part of the item.
//
// The seam suites' global setup runs the demo seed, which publishes the Rabaed Defaults (the WIR's Versions 1-4).
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { buildSeamTwoTower, c2Draft, testDatabaseUrls, wirAtConsultant, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const INTERNAL_NOTE = "Between K1: spacing out of tolerance at gridline 4";

let migrator: pg.Client;
let app: Db;

const towerOptions = { projectCode: "RIQ", k1Manager: true } as const;
let tower: SeamTwoTower<typeof towerOptions>;
/** C2's own Draft in Building B: C2 reaches the Project, so a refusal of C1's item is V3. */
let c2Own = "";

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  c2Own = await c2Draft(tower, { type: "WIR", title: "C2's own inspection" });
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

/** `as` takes `transition` on item `id` with `answers`, an Internal Note and a Recommended Code or Result. */
const takeWith = (as: string, id: string, transition: string, options: { answers?: object; note?: string; recommended?: string } = {}) =>
  tower.outcome(
    as,
    sql`select app.take_transition(${id}::uuid, ${transition}, ${JSON.stringify(options.answers ?? {})}::jsonb, ${options.note ?? ""},
      app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now(), null, ${options.recommended ?? null}) as outcome`,
  );

/**
 * Pins item `id` to Version `versionNo` of the Rabaed WIR Workflow, Steps by key, as an item started on it is
 * (apps/api/test/support/pin-version.ts, as the migrator).
 */
async function pinWir(id: string, versionNo: number): Promise<void> {
  const { rowCount } = await migrator.query(
    `with old as (
       select v.id as version_id, s.key, s.id as step_id from work_item_type t
       join workflow_version v on v.workflow_definition_id = t.workflow_definition_id and v.version_no = $2
       join workflow_step s on s.workflow_version_id = v.id
       where t.owner_kind = 'rabaed' and t.code = 'WIR'
     ),
     moved_assignments as (
       update step_assignment a set step_id = o.step_id
       from workflow_step cur, old o
       where a.work_item_id = $1 and cur.id = a.step_id and o.key = cur.key
       returning a.id
     )
     update work_item w set
       workflow_version_id = (select distinct version_id from old),
       current_step_id = (select o.step_id from old o join workflow_step cur on cur.key = o.key where cur.id = w.current_step_id),
       participant_entered_step_id = (select o.step_id from old o join workflow_step cur on cur.key = o.key where cur.id = w.participant_entered_step_id)
     where w.id = $1`,
    [id, versionNo],
  );
  expect(rowCount).toBe(1);
}

/** C1 raises a WIR, pinned to Workflow Version `versionNo`, Submits it; K1's Engineer picks it up. */
async function wirOnVersion(versionNo: number, title: string): Promise<string> {
  const { c1, k1, call, outcome, pickUp, take } = tower;
  const [created] = await call<{ outcome: string; work_item_id: string }>(
    c1.members.engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${tower.projectId}::uuid, 'WIR', ${title}, app.latest_form_version('WIR'), ${JSON.stringify({ checklist_template: tower.checklistVersionId })}::jsonb,
      ${tower.tradeId}::uuid, ${tower.buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  const id = created!.work_item_id;
  expect(await outcome(c1.members.engineer, sql`select app.sync_work_item_checklists(${id}::uuid, now()) as outcome`)).toBe("synced");
  await pinWir(id, versionNo);
  expect(await take(c1.members.engineer, id, "send_for_review")).toBe("applied");
  expect(await pickUp(c1.members.project_manager, id)).toBe("picked_up");
  expect(await take(c1.members.project_manager, id, "submit", { cover_note: "Ready on site from 09:00" })).toBe("applied");
  expect(await pickUp(k1.members.engineer, id)).toBe("picked_up");
  const [version] = (await migrator.query("select v.version_no from work_item w join workflow_version v on v.id = w.workflow_version_id where w.id = $1", [id])).rows;
  expect(version).toEqual({ version_no: versionNo });
  return id;
}

/** Everything `as` reads of item `id`: the item, its events table (RLS), their count and its history. */
async function itemAsRead(as: string, id: string) {
  const { call } = tower;
  return {
    item: await call<{ id: string; outcome: string | null }>(as, sql`select id, outcome from work_item where id = ${id}::uuid`),
    events: await call<{ type: string; payload: unknown }>(as, sql`select type, payload from work_item_event where work_item_id = ${id}::uuid order by seq`),
    count: (await call<{ n: number }>(as, sql`select count(*)::integer as n from work_item_event where work_item_id = ${id}::uuid`))[0]!.n,
    history: await call<{ seq: number; type: string; recommended_code: string | null; internal_note: string | null }>(
      as,
      sql`select seq, type, recommended_code, internal_note from app.work_item_history(${id}::uuid)`,
    ),
  };
}

/** The Recommended Code or Result as `as` reads it: the recommend_code events' payloads and the history's Internal Notes. */
async function recommendedCodeAsRead(as: string, id: string) {
  const read = await itemAsRead(as, id);
  return {
    recommended: read.events.filter((e) => e.type === "recommend_code").map((e) => e.payload),
    inHistory: read.history.filter((e) => e.type === "recommend_code").map((e) => e.recommended_code),
    notes: read.history.filter((e) => e.internal_note === INTERNAL_NOTE).length,
  };
}

/** C1's and the Owner's readers, who never read K1's Recommended Code or Result. */
const outsideK1 = () => [tower.c1.members.engineer, tower.c1.members.project_manager, tower.ow.members.representative];

/** Nothing of K1's Recommended Code or Result in what `as` reads: no recommend_code event, Recommended Code or Internal Note. */
async function expectNoRecommendedCode(as: string, id: string): Promise<Awaited<ReturnType<typeof itemAsRead>>> {
  const read = await itemAsRead(as, id);
  expect(read.item).toHaveLength(1);
  expect(read.events.map((e) => e.type)).not.toContain("recommend_code");
  expect(read.history.map((e) => e.type)).not.toContain("recommend_code");
  expect(read.history.map((e) => e.recommended_code)).toEqual(read.history.map(() => null));
  expect(JSON.stringify(read)).not.toContain(INTERNAL_NOTE);
  // Numbered 1, 2, 3… as they see them: no gap counts K1's internal events (V5).
  expect(read.history.map((e) => e.seq)).toEqual(read.history.map((_, i) => i + 1));
  return read;
}

/** C2 reads no part of item `id` (V3), and still reads its own. */
async function expectC2ReadsNothing(id: string): Promise<void> {
  const c2 = tower.c2.members.engineer;
  expect(await itemAsRead(c2, id)).toEqual({ item: [], events: [], count: 0, history: [] });
  expect((await itemAsRead(c2, c2Own)).item).toHaveLength(1);
}

describe("RP-170-1: a WIR on Workflow Version 2, K1's Engineer recommends Failed to K1's Manager", () => {
  it("is internal to K1: C1 and the Owner read none of it before or after the Result; C2 reads no part of the item", async () => {
    const { k1 } = tower;
    const id = await wirOnVersion(2, "Slab rebar, Level 2 (Version 2)");
    const before = new Map<string, Awaited<ReturnType<typeof itemAsRead>>>();
    for (const as of outsideK1()) before.set(as, await itemAsRead(as, id));

    expect(await takeWith(k1.members.engineer, id, "send_to_manager", { note: INTERNAL_NOTE, recommended: "failed" })).toBe("applied");
    expect(await tower.pickUp(k1.members.manager, id)).toBe("picked_up");
    expect(await takeWith(k1.members.manager, id, "return_to_engineer", { answers: { reason: "Photograph the cover at gridline 4" } })).toBe("applied");
    expect(await tower.pickUp(k1.members.engineer, id)).toBe("picked_up");
    expect(await takeWith(k1.members.engineer, id, "send_to_manager", { note: INTERNAL_NOTE, recommended: "failed" })).toBe("applied");
    expect(await tower.pickUp(k1.members.manager, id)).toBe("picked_up");

    // Before the Result, C1 and the Owner read what they read before K1 recommended: K1's Steps are internal.
    for (const as of outsideK1()) expect(await itemAsRead(as, id)).toEqual(before.get(as));
    // K1 reads both Recommended Results and their Internal Notes.
    for (const as of [k1.members.engineer, k1.members.manager]) {
      expect(await recommendedCodeAsRead(as, id)).toEqual({
        recommended: [{ recommended_code: "failed" }, { recommended_code: "failed" }],
        inHistory: ["failed", "failed"],
        notes: 2,
      });
    }

    expect(
      await takeWith(k1.members.manager, id, "pass_with_comments", {
        answers: { remarks: "Fix the cover", items_to_create: [{ comment: "Raise the cover to 40 mm" }] },
      }),
    ).toBe("applied");
    for (const as of outsideK1()) {
      const read = await expectNoRecommendedCode(as, id);
      expect(read.item).toEqual([{ id, outcome: "passed_with_comments" }]);
      // The Result and the Manager's shared reply.
      expect(JSON.stringify(read.events)).toContain("Fix the cover");
    }
    expect((await recommendedCodeAsRead(k1.members.manager, id)).notes).toBe(2);
    await expectC2ReadsNothing(id);
    // Stored internal to K1 only: the migrator reads the rows.
    const { rows } = await migrator.query(
      `select distinct e.audience, p.company_id from work_item_event e join participant p on p.id = e.audience_participant_id
       where e.work_item_id = $1 and e.type = 'recommend_code'`,
      [id],
    );
    expect(rows).toEqual([{ audience: "internal", company_id: k1.id }]);
  });
});

describe("RP-673-1: a WIR on Workflow Version 3, K1's Engineer recommends Code C to K1's Manager", () => {
  it("is internal to K1: C1 and the Owner read only the Code C; C2 reads nothing of the WIR", async () => {
    const { k1 } = tower;
    const id = await wirOnVersion(3, "Slab rebar, Level 3 (Version 3)");
    const before = new Map<string, Awaited<ReturnType<typeof itemAsRead>>>();
    for (const as of outsideK1()) before.set(as, await itemAsRead(as, id));

    expect(await takeWith(k1.members.engineer, id, "send_to_manager", { note: INTERNAL_NOTE, recommended: "C" })).toBe("applied");
    for (const as of outsideK1()) expect(await itemAsRead(as, id)).toEqual(before.get(as));
    for (const as of [k1.members.engineer, k1.members.manager]) {
      expect(await recommendedCodeAsRead(as, id)).toEqual({ recommended: [{ recommended_code: "C" }], inHistory: ["C"], notes: 1 });
    }

    expect(await tower.pickUp(k1.members.manager, id)).toBe("picked_up");
    expect(
      await takeWith(k1.members.manager, id, "revise_c", { answers: { sample_checked: true, matches_specification: true, remarks: "Spacing out of tolerance" } }),
    ).toBe("applied");
    for (const as of outsideK1()) {
      const read = await expectNoRecommendedCode(as, id);
      expect(read.item).toEqual([{ id, outcome: "C" }]);
      expect(read.count).toBe(before.get(as)!.count + 1);
    }
    await expectC2ReadsNothing(id);
  });
});

describe("RP-652-1: the Project shows Inspections in its Submittals tab", () => {
  /** The ids and Stage keys app.work_items_seen gives `as` for `modules`, as the Submittals tab reads them. */
  const seen = async (as: string, modules: string[]) =>
    (
      await tower.call<{ id: string; stage_key: string }>(
        as,
        sql`select id, stage_key from app.work_items_seen(${tower.projectId}::uuid, ${modules}::text[], false)`,
      )
    ).sort((a, b) => a.id.localeCompare(b.id));

  it("widens where each viewer's own rows show, never which rows: C2 reads none of C1's WIR", async () => {
    const { c1, k1, c2, ow } = tower;
    const wir = await wirAtConsultant(tower, { type: "WIR", title: "Slab pour (Submittals tab)" });
    expect(await tower.outcome(c1.ap, sql`select app.set_show_inspections_in_submittals(${tower.projectId}::uuid, true) as outcome`)).toBe("set");
    const shown = await tower.call<{ show: boolean }>(
      c2.members.engineer,
      sql`select show_inspections_in_submittals as show from project where id = ${tower.projectId}::uuid`,
    );
    expect(shown).toEqual([{ show: true }]);

    const submittalStages = (await migrator.query("select key from stage where project_id = $1 and module_key = 'submittals'", [tower.projectId])).rows.map(
      (r) => r.key as string,
    );
    for (const as of [c1.members.engineer, k1.members.manager, ow.members.representative, c2.members.engineer]) {
      const both = await seen(as, ["submittals", "inspections"]);
      const each = [...(await seen(as, ["submittals"])), ...(await seen(as, ["inspections"]))].sort((a, b) => a.id.localeCompare(b.id));
      expect(both).toEqual(each);
    }
    for (const as of [c1.members.engineer, k1.members.manager]) {
      const row = (await seen(as, ["submittals", "inspections"])).find((r) => r.id === wir);
      expect(row).toBeDefined();
      // In the same Stage group as a submittal of the same Stage key (ADR 0025).
      expect(submittalStages).toContain(row!.stage_key);
    }
    expect((await seen(c2.members.engineer, ["submittals", "inspections"])).map((r) => r.id)).toEqual([c2Own]);
    // Need My Action reads through the same check: K1's Engineer, who holds the WIR, needs to act; C2 gets nothing.
    const need = (as: string) => tower.call<{ need: string | null }>(as, sql`select app.need_my_action(${wir}::uuid) as need`);
    expect((await need(k1.members.engineer))[0]!.need).not.toBeNull();
    expect(await need(c2.members.engineer)).toEqual([{ need: null }]);
    await expectC2ReadsNothing(wir);
  });
});

describe("RP-656-1: C1's engineer annotates a photo on a MAR, then C1 Submits it", () => {
  /** `as` starts and confirms an upload by `start` (a query giving outcome and document_id); returns the id. */
  async function upload(as: string, itemId: string, start: ReturnType<typeof sql<{ outcome: string; document_id: string }>>, size: number): Promise<string> {
    const [started] = await tower.call(as, start);
    expect(started!.outcome).toBe("started");
    expect(
      await tower.outcome(
        as,
        sql`select app.confirm_document_upload(${itemId}::uuid, ${started!.document_id}::uuid, ${size}, 'image/jpeg', ${randomBytes(32)}::bytea, now()) as outcome`,
      ),
    ).toBe("confirmed");
    return started!.document_id;
  }

  it("C1 and K1 read both, the copy linked to the untouched original; C2 reads neither and can't annotate it", async () => {
    const { c1, k1, c2, call, take, pickUp } = tower;
    const engineer = c1.members.engineer;
    const [created] = await call<{ outcome: string; work_item_id: string }>(
      engineer,
      sql`select outcome, work_item_id from app.create_work_item(
        ${tower.projectId}::uuid, 'MAR', 'Rebar couplers', app.latest_form_version('MAR'), '{}'::jsonb,
        ${tower.tradeId}::uuid, ${tower.buildingA}::uuid, now())`,
    );
    expect(created!.outcome).toBe("created");
    const id = created!.work_item_id;
    const original = await upload(
      engineer,
      id,
      sql`select outcome, document_id from app.start_document_upload(${id}::uuid, 'coupler.jpg', 1024, 'image/jpeg', now())`,
      1024,
    );
    const fingerprint = async () => (await migrator.query("select file_sha256 from document where id = $1", [original])).rows[0].file_sha256 as Buffer;
    const before = await fingerprint();
    const copy = await upload(
      engineer,
      id,
      sql`select outcome, document_id from app.start_annotated_copy_upload(${id}::uuid, ${original}::uuid, 'coupler-annotated.jpg', 2048, 'image/jpeg', now())`,
      2048,
    );
    expect(await take(engineer, id, "send_for_review")).toBe("applied");
    expect(await pickUp(c1.members.project_manager, id)).toBe("picked_up");
    expect(await take(c1.members.project_manager, id, "submit")).toBe("applied");

    const documents = (as: string) =>
      call<{ id: string; annotated_from_id: string | null }>(as, sql`select id, annotated_from_id from document where work_item_id = ${id}::uuid order by annotated_from_id nulls first`);
    for (const as of [engineer, c1.members.project_manager, k1.members.engineer, k1.members.manager]) {
      expect(await documents(as)).toEqual([
        { id: original, annotated_from_id: null },
        { id: copy, annotated_from_id: original },
      ]);
    }
    expect((await fingerprint()).equals(before)).toBe(true);

    // C2: neither row, by the item or by either id, and no annotation, as for a made-up id.
    expect(await documents(c2.members.engineer)).toEqual([]);
    expect(await call(c2.members.engineer, sql<{ id: string }>`select id from document where id in (${original}::uuid, ${copy}::uuid)`)).toEqual([]);
    const annotate = (documentId: string) =>
      call<{ outcome: string }>(
        c2.members.engineer,
        sql`select outcome from app.start_annotated_copy_upload(${id}::uuid, ${documentId}::uuid, 'mine.jpg', 2048, 'image/jpeg', now())`,
      ).then((rows) => rows.map((r) => r.outcome));
    expect(await annotate(original)).toEqual(["not_found"]);
    expect(await annotate(copy)).toEqual(["not_found"]);
    expect(await annotate(randomUUID())).toEqual(["not_found"]);
    const { rows } = await migrator.query("select count(*)::integer as n from document where work_item_id = $1", [id]);
    expect(rows[0].n).toBe(2);
    await expectC2ReadsNothing(id);
  });
});
