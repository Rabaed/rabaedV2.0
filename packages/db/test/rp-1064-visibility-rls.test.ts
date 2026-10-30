// Seam 2 for where the Submittal Panel's route strip (RP-1064) and its rail's Step list (RP-1093) put
// the item, as the app role (visibility.md V14, ADR 0022; scenarios RP-1064-1 and RP-1093-1). The
// item's map read (RP-438) takes it from app.step_as_seen, app.work_item_holder and
// app.with_owner_review: inside the reader's own Participant, the current Step; anyone else gets
// only the Step it arrived at in the holder's Participant and that Company's name, so K1's move
// from its Engineer to its Manager reaches C1 as nothing; at the Owner's review, "Owner review" to
// all but its holder and the recommending Consultant. Seam 1: apps/api/test/rp-1064-visibility.test.ts.
import { randomInt } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addOwnerReviewWorkflow, addTestWorkflow, bilingual, buildSeamTwoTower, digits, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("");
const TYPE = `RS${letters(3)}`;
const OWNER_TYPE = `RO${letters(3)}`;
const OWNER_REVIEW = { en: "Owner review", ar: "مراجعة المالك" };

let migrator: pg.Client;
let app: Db;
const towerOptions = { projectCode: "RSS", k1Manager: true } as const;
let tower: SeamTwoTower<typeof towerOptions>;

type Seen = { id: string; step_key: string; holder_mine: boolean | null; holder_name: { en: string; ar: string } | null };
/**
 * Where `as` reads item `item`, from what the map read reads: the Step as seen, whether its holder is the reader's own
 * Participant (null when no holder reaches them; the map takes "Owner review" as not their own), and the holder's name.
 */
const seen = async (as: string, item: string) =>
  tower.call<Seen>(
    as,
    sql`select w.id, s.key as step_key, a.participant_id in (select app.current_participant_ids()) as holder_mine,
        coalesce(app.with_owner_review(w.id), holder.legal_name) as holder_name
      from work_item w
      cross join lateral app.step_as_seen(w.id) seen
      join workflow_step s on s.id = seen.step_id
      left join app.work_item_holder(w.id) a on true
      left join app.work_item_companies(w.id) holder on holder.participant_id = a.participant_id
      where w.id = ${item}::uuid`,
  );
/** The Step `as` is shown item `item` at, as a row for expectHiddenFrom: none unless the holder is their own Participant. */
const ownStep = (item: string) => async (as: string) => (await seen(as, item)).flatMap((r) => (r.holder_mine ? [{ id: r.step_key }] : []));
const names = new Map<string, string>();
const named = (as: string) => names.get(as) ?? as;

/** A form with one text field, published, for a test Type; returns its id. */
async function form(name: string): Promise<string> {
  const id = (await migrator.query("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual(name))])).rows[0].id as string;
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    id,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  return id;
}

async function addType(code: string, workflowId: string, name: string) {
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4)`,
    [code, JSON.stringify(bilingual(name)), workflowId, await form(name)],
  );
}

/** C1's Engineer raises an item of `type` in Building A and sends it to C1's review; returns its id. */
async function raised(type: string, title: string): Promise<string> {
  const [created] = await tower.call<{ outcome: string; work_item_id: string }>(
    tower.c1.members.engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${tower.projectId}::uuid, ${type}, ${title}, app.latest_form_version(${type}), ${JSON.stringify({ model: title })}::jsonb,
      ${tower.tradeId}::uuid, ${tower.buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  const id = created!.work_item_id;
  expect(await tower.take(tower.c1.members.engineer, id, "send_for_review")).toBe("applied");
  return id;
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const run = (text: string) => migrator.query(text);
  await addType(TYPE, await addTestWorkflow(run, { name: bilingual(`RP-1064 route strip ${digits(6)}`) }), "Route strip (RP-1064)");
  await addType(OWNER_TYPE, await addOwnerReviewWorkflow(run), "Route strip at the Owner (RP-1064)");
  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  const { c1, k1, ow, c2 } = tower;
  for (const [as, name] of [
    [c1.members.engineer, "C1 engineer"],
    [c1.members.project_manager, "C1 PM"],
    [k1.members.engineer, "K1 engineer"],
    [k1.members.manager, "K1 manager"],
    [ow.members.representative, "OW representative"],
    [c2.members.engineer, "C2 engineer"],
  ] as const)
    names.set(as, name);
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenarios RP-1064-1 and RP-1093-1: C1's Submitted item, which K1's Engineer sends to K1's Manager", () => {
  let id = "";
  let inReview: Seen[] = [];
  let atEngineer: Seen[] = [];
  let atManager: Seen[] = [];

  beforeAll(async () => {
    const { c1, k1 } = tower;
    id = await raised(TYPE, "Cable trays");
    expect(await tower.pickUp(c1.members.project_manager, id)).toBe("picked_up");
    inReview = await seen(c1.members.project_manager, id);
    expect(await tower.take(c1.members.project_manager, id, "submit")).toBe("applied");
    expect(await tower.pickUp(k1.members.engineer, id)).toBe("picked_up");
    atEngineer = await seen(c1.members.project_manager, id);
    expect(await tower.take(k1.members.engineer, id, "send_to_manager")).toBe("applied");
    atManager = await seen(c1.members.project_manager, id);
  });

  it("gives C1 its own Step while C1 holds it (the positive control)", () => {
    expect(inReview).toEqual([{ id, step_key: "internal_review", holder_mine: true, holder_name: bilingual("C1") }]);
  });

  it("gives C1 K1's whole stop, by K1's name and the Step it arrived at, the same before and after K1's internal move", () => {
    expect(atManager).toEqual([{ id, step_key: "consultant_review", holder_mine: false, holder_name: bilingual("K1") }]);
    expect(atManager).toEqual(atEngineer);
  });

  it("gives K1's current Step to K1's Members only", async () => {
    const { c1, k1, ow } = tower;
    await expectHiddenFrom({
      read: ownStep(id),
      target: "consultant_approval",
      seenBy: [k1.members.manager, k1.members.engineer],
      hiddenFrom: [c1.members.project_manager, c1.members.engineer, ow.members.representative],
      name: named,
      label: "K1's current Step",
    });
  });

  it("gives a Contractor who doesn't see the item nothing of it, while C1 reads it", async () => {
    const { c1, c2 } = tower;
    await expectHiddenFrom({ read: (as: string) => seen(as, id), target: id, seenBy: c1.members.project_manager, hiddenFrom: c2.members.engineer, name: named, label: "the item" });
  });
});

describe("scenario RP-1064-1: later the item waits at the Owner's review", () => {
  let id = "";

  beforeAll(async () => {
    const { c1, k1, ow } = tower;
    // The Owner's review is an approving Step: OW's representative is its Project Manager too.
    expect(
      await tower.outcome(
        ow.ap,
        sql`select app.set_project_member_positions(${ow.participantId}::uuid, ${ow.members.representative}::uuid, ${["representative", "project_manager"]}::text[]) as outcome`,
      ),
    ).toBe("set");
    id = await raised(OWNER_TYPE, "Busbar trunking");
    expect(await tower.pickUp(c1.members.project_manager, id)).toBe("picked_up");
    expect(await tower.take(c1.members.project_manager, id, "submit")).toBe("applied");
    expect(await tower.pickUp(k1.members.manager, id)).toBe("picked_up");
    expect(await tower.take(k1.members.manager, id, "recommend_a")).toBe("applied");
  });

  it("reads to C1 as with Owner review, not as the Owner's Company", async () => {
    // No holder reaches C1 (RP-1138), so whether it is C1's own reads as nothing.
    expect(await seen(tower.c1.members.project_manager, id)).toEqual([{ id, step_key: "owner_review", holder_mine: null, holder_name: OWNER_REVIEW }]);
  });

  it("gives the Owner's Step to the Owner only", async () => {
    const { c1, k1, ow } = tower;
    await expectHiddenFrom({
      read: ownStep(id),
      target: "owner_review",
      seenBy: ow.members.representative,
      hiddenFrom: [c1.members.project_manager, k1.members.manager],
      name: named,
      label: "the Owner's Step",
    });
  });
});
