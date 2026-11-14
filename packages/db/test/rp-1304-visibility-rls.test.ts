// Seam 2 for the "Whole Project" Location (RP-1304; GLOSSARY â€º Location; data-model.md Â§3; visibility.md row 4,
// V12, V19; scenarios RP-1304-1 to RP-1304-7), as the app role. Every Project has one, at the top of its Locations.
// An item there is covered by any Location (owner's decision on RP-1304, 2026-11-14): within the Companies that
// already see it, a Member whose Visibility covers any Location of the Project sees it, while its Trade must still
// be covered. It is no value a grant lists, and no Visibility Gap names it. Seam 1: apps/api/test/rp-1304-visibility.test.ts.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, digits, expectHiddenFrom, testDatabaseUrls, wirAtConsultant, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const towerOptions = { projectCode: "RWP", otherProject: true, k1Manager: true } as const;

let migrator: pg.Client;
let app: Db;
let tower: SeamTwoTower<typeof towerOptions>;
let wholeProject = "";
let mechanical = "";

type Location = { id: string; parent_id: string | null; depth: number; code: string; name: { en: string; ar: string }; whole_project: boolean };

/** The Project's Locations as `as` reads them, in the order the screens list them. */
const locations = (as: string, projectId = tower.projectId) =>
  tower.call<Location>(
    as,
    sql`select v.id, v.parent_id, v.depth, v.code, v.name, v.whole_project
      from dimension_value v join visibility_dimension d on d.id = v.dimension_id
      where d.project_id = ${projectId}::uuid and d.kind = 'location'
      order by v.depth, v.sort, v.id`,
  );

const setMember = (member: string, kind: "trade" | "location", values: string[] | "all") =>
  tower.outcome(
    tower.k1.ap,
    sql`select app.set_member_visibility(${tower.k1.participantId}::uuid, ${member}::uuid, ${kind}, ${values === "all"}, ${values === "all" ? [] : values}::uuid[], now()) as outcome`,
  );
const setParticipant = (participant: string, kind: "trade" | "location", values: string[] | "all") =>
  tower.outcome(
    tower.c1.ap,
    sql`select app.set_participant_visibility(${participant}::uuid, ${kind}, ${values === "all"}, ${values === "all" ? [] : values}::uuid[], now()) as outcome`,
  );

/** Whether `as` reads item `id` (the work_item policy: app.sees_work_item). */
const reads = (id: string) => (as: string) => tower.call<{ id: string }>(as, sql`select id from work_item where id = ${id}::uuid`);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  wholeProject = (await locations(tower.c1.ap)).find((l) => l.whole_project)!.id;
  const [added] = await tower.call<{ outcome: string; value_id: string }>(
    tower.c1.ap,
    sql`select outcome, value_id from app.add_dimension_value(${tower.projectId}::uuid, 'trade', null, 'ME', ${JSON.stringify(bilingual("Mechanical"))}::jsonb)`,
  );
  mechanical = added!.value_id;
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-1304-1: every Project has one Whole Project Location, at the top, and it is no grant's value", () => {
  it("lists it first, above the Zones, named in English and Arabic", async () => {
    const [first, ...rest] = await locations(tower.c1.members.engineer);
    expect(first).toMatchObject({ parent_id: null, depth: 1, code: "WP", name: { en: "Whole Project", ar: "المشروع كامل" }, whole_project: true });
    expect(rest.map((l) => l.id)).toEqual([tower.buildingA, tower.buildingB]);
    expect(rest.every((l) => !l.whole_project)).toBe(true);
  });

  it("gives a new Project its own, and only one", async () => {
    const other = await locations(tower.other.ap, tower.other.projectId);
    const own = await migrator.query("select id from dimension_value where project_id = $1 and whole_project", [tower.other.projectId]);
    expect(other.map((l) => l.id)).toEqual(own.rows.map((r: { id: string }) => r.id));
    expect(other[0]).toMatchObject({ code: "WP", whole_project: true });
    expect(other[0]!.id).not.toBe(wholeProject);
  });

  it("refuses it in a Participant's grant and a Member's", async () => {
    expect(await setParticipant(tower.k1.participantId, "location", [wholeProject])).toBe("value_not_found");
    expect(await setParticipant(tower.k1.participantId, "location", [tower.buildingA, wholeProject])).toBe("value_not_found");
    expect(await setMember(tower.k1.members.manager, "location", [wholeProject])).toBe("value_not_found");
  });

  it("takes no Location inside it, and is not renamed or archived", async () => {
    const [added] = await tower.call<{ outcome: string }>(
      tower.c1.ap,
      sql`select outcome from app.add_dimension_value(${tower.projectId}::uuid, 'location', ${wholeProject}::uuid, 'B1', ${JSON.stringify(bilingual("Inside"))}::jsonb)`,
    );
    expect(added!.outcome).toBe("parent_not_found");
    for (const change of [sql`${JSON.stringify(bilingual("Site"))}::jsonb, null::boolean`, sql`null::jsonb, false`]) {
      expect(await tower.outcome(tower.c1.ap, sql`select app.update_dimension_value(${wholeProject}::uuid, 'location', ${change}, now()) as outcome`)).toBe("not_found");
    }
  });

  it("is in no Participant's covered values, though they cover a Location", async () => {
    const covered = await tower.call<{ id: string }>(tower.k1.ap, sql`select id from app.participant_covered_values(${tower.k1.participantId}::uuid)`);
    expect(covered.map((v) => v.id)).toContain(tower.buildingA);
    expect(covered.map((v) => v.id)).not.toContain(wholeProject); // not hidden-from: it is no value a grant lists (the editor's choices), not a hidden row
  });

  it("is the Location a Member covering any Location raises an item at, and one covering none is refused", async () => {
    // C1's engineer covers Building A only, then no Location.
    const setC1 = (values: string[]) =>
      tower.outcome(
        tower.c1.ap,
        sql`select app.set_member_visibility(${tower.c1.participantId}::uuid, ${tower.c1.members.engineer}::uuid, 'location', false, ${values}::uuid[], now()) as outcome`,
      );
    const raise = async () =>
      (
        await tower.call<{ outcome: string }>(
          tower.c1.members.engineer,
          sql`select outcome from app.create_work_item(${tower.projectId}::uuid, 'WIR', 'General specification', app.latest_form_version('WIR'), '{}'::jsonb, ${tower.tradeId}::uuid, ${wholeProject}::uuid, now())`,
        )
      )[0]!.outcome;
    expect(await setC1([tower.buildingA])).toBe("set");
    expect(await raise()).toBe("created");
    expect(await setC1([])).toBe("set");
    expect(await raise()).toBe("outside_visibility");
    expect(await tower.outcome(tower.c1.ap, sql`select app.set_member_visibility(${tower.c1.participantId}::uuid, ${tower.c1.members.engineer}::uuid, 'location', true, '{}'::uuid[], now()) as outcome`)).toBe("set");
  });

  it("is in no Visibility Gap: the Project's, or a Participant's whose Members cover no Location", async () => {
    // First no Participant covers a Location; then only C2 covers Building B, and its engineer none.
    const gapTower = await buildSeamTwoTower(app, migrator, { projectCode: "RWG" });
    const setLocations = (p: string, values: string[]) =>
      gapTower.outcome(gapTower.c1.ap, sql`select app.set_participant_visibility(${p}::uuid, 'location', false, ${values}::uuid[], now()) as outcome`);
    for (const p of [gapTower.c1.participantId, gapTower.k1.participantId, gapTower.ow.participantId, gapTower.c2.participantId]) {
      expect(await setLocations(p, [])).toBe("set");
    }
    const gap = await gapTower.call<{ id: string }>(gapTower.c1.ap, sql`select id from app.project_visibility_gap(${gapTower.projectId}::uuid) where kind = 'location'`);
    expect(gap.map((v) => v.id).sort()).toEqual([gapTower.buildingA, gapTower.buildingB].sort());
    expect(await setLocations(gapTower.c2.participantId, [gapTower.buildingB])).toBe("set");
    expect(
      await gapTower.outcome(
        gapTower.c2.ap,
        sql`select app.set_member_visibility(${gapTower.c2.participantId}::uuid, ${gapTower.c2.members.engineer}::uuid, 'location', false, '{}'::uuid[], now()) as outcome`,
      ),
    ).toBe("set");
    const ownGap = await gapTower.call<{ id: string }>(gapTower.c2.ap, sql`select id from app.participant_visibility_gap(${gapTower.c2.participantId}::uuid) where kind = 'location'`);
    expect(ownGap.map((v) => v.id)).toEqual([gapTower.buildingB]);
  });
});

describe("a Whole Project item, Submitted by C1 to K1 (Electrical)", () => {
  let item = "";

  beforeAll(async () => {
    // wirAtConsultant raises it at the Location it is given as `buildingA`: here, the Whole Project.
    item = await wirAtConsultant({ ...tower, buildingA: wholeProject }, { type: "WIR", title: "General specification" });
  });

  describe("scenario RP-1304-2: a Member covering Building A only sees it, its Trade covered", () => {
    it("is read by K1's manager, narrowed to Electrical and Building A", async () => {
      expect(await setMember(tower.k1.members.manager, "trade", [tower.tradeId])).toBe("set");
      expect(await setMember(tower.k1.members.manager, "location", [tower.buildingA])).toBe("set");
      await expectHiddenFrom({
        read: reads(item),
        target: item,
        seenBy: [tower.k1.members.manager, tower.k1.members.engineer, tower.c1.members.engineer],
        hiddenFrom: [tower.c2.members.engineer],
        label: "a Whole Project item, to a Building A-only Member",
      });
    });

    it("is read the same through Building B: any Location covers it", async () => {
      expect(await setMember(tower.k1.members.manager, "location", [tower.buildingB])).toBe("set");
      expect((await reads(item)(tower.k1.members.manager)).map((r) => r.id)).toEqual([item]);
    });

    it("is read through a grant listing only an archived Zone, which keeps the Visibility it gave (RP-1239)", async () => {
      const [added] = await tower.call<{ outcome: string; value_id: string }>(
        tower.c1.ap,
        sql`select outcome, value_id from app.add_dimension_value(${tower.projectId}::uuid, 'location', null, 'ZR', ${JSON.stringify(bilingual("Zone R"))}::jsonb)`,
      );
      expect(await setMember(tower.k1.members.manager, "location", [added!.value_id])).toBe("set");
      expect(await tower.outcome(tower.c1.ap, sql`select app.update_dimension_value(${added!.value_id}::uuid, 'location', null::jsonb, false, now()) as outcome`)).toBe("updated");
      expect((await reads(item)(tower.k1.members.manager)).map((r) => r.id)).toEqual([item]);
    });
  });

  describe("scenario RP-1304-3: not when the Member's Trade isn't the item's, or they cover no Location", () => {
    it("is hidden from K1's manager on Mechanical and Building A, and on Electrical with no Location", async () => {
      expect(await setMember(tower.k1.members.manager, "trade", [mechanical])).toBe("set");
      expect(await setMember(tower.k1.members.manager, "location", [tower.buildingA])).toBe("set");
      await expectHiddenFrom({
        read: reads(item),
        target: item,
        seenBy: tower.k1.members.engineer,
        hiddenFrom: tower.k1.members.manager,
        label: "a Whole Project item, to a Member of another Trade",
      });
      expect(await setMember(tower.k1.members.manager, "trade", [tower.tradeId])).toBe("set");
      expect(await setMember(tower.k1.members.manager, "location", [])).toBe("set");
      await expectHiddenFrom({
        read: reads(item),
        target: item,
        seenBy: tower.k1.members.engineer,
        hiddenFrom: tower.k1.members.manager,
        label: "a Whole Project item, to a Member covering no Location",
      });
    });

    it("is hidden when the Participant covers no Location, though its Member's grant is all of it", async () => {
      expect(await setMember(tower.k1.members.manager, "location", "all")).toBe("set");
      expect(await setParticipant(tower.k1.participantId, "location", [])).toBe("set");
      await expectHiddenFrom({
        read: reads(item),
        target: item,
        seenBy: tower.c1.members.engineer,
        hiddenFrom: [tower.k1.members.manager, tower.k1.members.engineer],
        label: "a Whole Project item, to a Participant covering no Location",
      });
      expect(await setParticipant(tower.k1.participantId, "location", "all")).toBe("set");
    });
  });

  describe("scenario RP-1304-4: the Company rules are unchanged: who couldn't see it still can't", () => {
    it("is hidden from C2, which covers every Trade and Building B, and from another Project's Company", async () => {
      await expectHiddenFrom({
        read: reads(item),
        target: item,
        seenBy: tower.k1.members.engineer,
        hiddenFrom: [tower.c2.ap, tower.c2.members.engineer, tower.other.ap],
        label: "a Whole Project item, to the Companies it was never sent to",
      });
    });
  });

  describe("scenario RP-1304-5: narrowing a Participant never leaves a Member with the Whole Project alone", () => {
    it("leaves K1's manager on Building A covering nothing once K1 is narrowed to Building B", async () => {
      expect(await setMember(tower.k1.members.manager, "location", [tower.buildingA])).toBe("set");
      expect(await setParticipant(tower.k1.participantId, "location", [tower.buildingB])).toBe("set");
      const grants = await tower.call<{ kind: string; is_all: boolean; value_ids: string[] }>(
        tower.k1.ap,
        sql`select * from app.member_grants(${tower.k1.participantId}::uuid, ${tower.k1.members.manager}::uuid) where kind = 'location'`,
      );
      expect(grants).toEqual([{ kind: "location", is_all: false, value_ids: [] }]);
      await expectHiddenFrom({
        read: reads(item),
        target: item,
        seenBy: tower.k1.members.engineer,
        hiddenFrom: tower.k1.members.manager,
        label: "a Whole Project item, to a Member narrowed out of every Location",
      });
      expect(await setParticipant(tower.k1.participantId, "location", "all")).toBe("set");
    });
  });

  describe("scenario RP-1304-6: a Participant covering any Location covers it, as the Vacancy hand-off asks (RP-1262)", () => {
    const covers = async (participant: string) =>
      (await migrator.query("select app.participant_covers_item($1, $2) as covers", [participant, item])).rows[0].covers as boolean;

    it("is covered by C2 (Building B and every Trade), and by no Participant without a Location or the Trade", async () => {
      expect(await covers(tower.c2.participantId)).toBe(true);
      expect(await setParticipant(tower.c2.participantId, "location", [])).toBe("set");
      expect(await covers(tower.c2.participantId)).toBe(false);
      expect(await setParticipant(tower.c2.participantId, "location", [tower.buildingB])).toBe("set");
      expect(await setParticipant(tower.c2.participantId, "trade", [mechanical])).toBe("set");
      expect(await covers(tower.c2.participantId)).toBe(false);
      expect(await setParticipant(tower.c2.participantId, "trade", "all")).toBe("set");
    });
  });
});

describe("scenario RP-1304-7: Sent Back, K1 reads it as it arrived (V19): at the Whole Project", () => {
  // A Type on the test Workflow (a Send Back to C1's Draft, which reopens the Form).
  const TYPE = `WP${Array.from({ length: 3 }, () => String.fromCharCode(65 + randomInt(26))).join("")}`;
  const schema = {
    sections: [
      {
        key: "classification",
        title: bilingual("Classification"),
        fields: [
          { key: "model", type: "text", label: bilingual("Model") },
          { key: "trade", type: "trade", label: bilingual("Trade") },
          { key: "location", type: "location", label: bilingual("Location") },
          { key: "scopes", type: "scopes", label: bilingual("Scopes") },
        ],
      },
    ],
  };
  const take = (as: string, id: string, transition: string) =>
    tower.outcome(as, sql`select app.take_transition(${id}::uuid, ${transition}, '{}'::jsonb, '', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome`);
  let sentBack = "";

  beforeAll(async () => {
    const workflowId = await addTestWorkflow((text) => migrator.query(text), {
      name: bilingual(`RP-1304 ${digits(6)}`),
      afterSendBack: { draft: "edit_form", internal_review: "edit_form" },
    });
    const form = (await migrator.query("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Whole Project"))])).rows[0].id as string;
    await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [form, JSON.stringify(schema)]);
    await migrator.query(
      "insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id) values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4)",
      [TYPE, JSON.stringify(bilingual("Whole Project")), workflowId, form],
    );
    // K1's manager covers Electrical and Building A only.
    expect(await setMember(tower.k1.members.manager, "trade", [tower.tradeId])).toBe("set");
    expect(await setMember(tower.k1.members.manager, "location", [tower.buildingA])).toBe("set");
    const [created] = await tower.call<{ outcome: string; work_item_id: string }>(
      tower.c1.members.engineer,
      sql`select outcome, work_item_id from app.create_work_item(${tower.projectId}::uuid, ${TYPE}, 'General specification', app.latest_form_version(${TYPE}),
        '{"model": "GS-1"}'::jsonb, ${tower.tradeId}::uuid, ${wholeProject}::uuid, now())`,
    );
    expect(created!.outcome).toBe("created");
    sentBack = created!.work_item_id;
    expect(await take(tower.c1.members.engineer, sentBack, "send_for_review")).toBe("applied");
    expect(await tower.pickUp(tower.c1.members.project_manager, sentBack)).toBe("picked_up");
    expect(await take(tower.c1.members.project_manager, sentBack, "submit")).toBe("applied");
    expect(await tower.pickUp(tower.k1.members.engineer, sentBack)).toBe("picked_up");
    expect(await take(tower.k1.members.engineer, sentBack, "send_back_to_draft")).toBe("applied");
    // C1's engineer moves it to Building B, which K1's manager doesn't cover, before Submitting again.
    expect(
      await tower.outcome(
        tower.c1.members.engineer,
        sql`select app.save_work_item_answers(${sentBack}::uuid, '{"model": "GS-1"}'::jsonb, ${tower.tradeId}::uuid, ${tower.buildingB}::uuid, '{}'::uuid[], now()) as outcome`,
      ),
    ).toBe("saved");
  });

  it("is read by K1's Building A manager while C1 has it at Building B, and by no K1 Member covering no Location", async () => {
    const location = async (as: string) =>
      (
        await tower.call<{ value_id: string }>(
          as,
          sql`select v.id as value_id from work_item_dimension_value wv join dimension_value v on v.id = wv.dimension_value_id
            join visibility_dimension d on d.id = v.dimension_id where wv.work_item_id = ${sentBack}::uuid and d.kind = 'location'`,
        )
      ).map((r) => r.value_id);
    expect(await location(tower.c1.members.engineer)).toEqual([tower.buildingB]);
    await expectHiddenFrom({
      read: reads(sentBack),
      target: sentBack,
      seenBy: tower.k1.members.manager,
      hiddenFrom: tower.c2.members.engineer,
      label: "a Sent Back item that arrived at the Whole Project",
    });
    const [arrived] = await migrator.query("select built_ins_as_arrived -> 'dimensions' as dimensions from work_item where id = $1", [sentBack]).then((r) => r.rows);
    expect(Object.values(arrived.dimensions as Record<string, string>)).toContain(wholeProject);
    expect(await setMember(tower.k1.members.manager, "location", [])).toBe("set");
    await expectHiddenFrom({
      read: reads(sentBack),
      target: sentBack,
      seenBy: tower.c1.members.engineer,
      hiddenFrom: tower.k1.members.manager,
      label: "a Sent Back item, to a K1 Member covering no Location",
    });
  });
});
