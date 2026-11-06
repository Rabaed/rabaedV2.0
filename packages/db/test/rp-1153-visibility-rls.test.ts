// Seam 2 for the bell's and the Notifications page's read (RP-1153; visibility.md "Notifications and
// emails"; scenarios RP-1153-1 and RP-1153-2), as the app role. app.notification_pools answers, for the
// reader's own "Step reached" notifications only, whether each came to their Step Pool and still waits
// there: two booleans, never a time (the app role is granted no step_assignment time). The rest of the
// read is the notification, project, outcome and work item rows through their own policies, and
// app.work_item_companies for the Company named, by name only (V14). Seam 1: rp-1153-visibility.test.ts.
import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, digits, drainOutbox, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const TYPE = `NP${Array.from({ length: 3 }, () => String.fromCharCode(65 + randomInt(26))).join("")}`;
const wirForm = readFileSync(new URL("../../../apps/admin/forms/WIR.json", import.meta.url), "utf8");

let migrator: pg.Client;
let app: Db;
const towerOptions = { projectCode: "RNP", k1Manager: true } as const;
let tower: SeamTwoTower<typeof towerOptions>;
let item = "";

type Pool = { notification_id: string; pool: boolean; waiting: boolean };
const one = async (text: string, values: unknown[]): Promise<string> => (await migrator.query(text, values)).rows[0].id as string;
/** The ids of every "Step reached" about the item, as the owner reads them: anyone's. */
const stepReachedIds = async () =>
  (await migrator.query<{ id: string }>("select id from notification where work_item_id = $1 and kind = 'step_reached' order by id", [item])).rows.map((r) => r.id);
/** What app.notification_pools answers `as` about `ids`. */
const pools = (as: string, ids: string[]) => tower.call<Pool>(as, sql`select notification_id, pool, waiting from app.notification_pools(${ids}::uuid[])`);
const ownStepReached = async (as: string) =>
  (await tower.call<{ id: string }>(as, sql`select id from notification where work_item_id = ${item}::uuid and kind = 'step_reached'`)).map((r) => r.id);

const names = new Map<string, string>();
const named = (as: string) => names.get(as) ?? "a Member";

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const workflowId = await addTestWorkflow((text) => migrator.query(text), { name: bilingual(`RP-1153 pools ${digits(6)}`) });
  const formId = await one("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Inspection (RP-1153)"))]);
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [formId, wirForm]);
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     select 'rabaed', module_key, $1, $2, $3, outcome_kind, $4 from work_item_type where owner_kind = 'rabaed' and code = 'WIR'`,
    [TYPE, JSON.stringify(bilingual("Inspection (RP-1153)")), workflowId, formId],
  );
  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  const { c1, k1, c2, ow } = tower;
  names.set(c1.members.engineer, "C1 engineer").set(c1.members.project_manager, "C1 PM").set(k1.members.engineer, "K1 engineer");
  names.set(k1.members.manager, "K1 manager").set(c2.members.engineer, "C2 engineer").set(ow.members.representative, "OW");

  // C1 raises it and Submits it to K1's Consultant review, whose pool is K1's Engineer and Manager.
  const [created] = await tower.call<{ outcome: string; work_item_id: string }>(
    c1.members.engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${tower.projectId}::uuid, ${TYPE}, 'Cable tray supports', app.latest_form_version(${TYPE}),
      ${JSON.stringify({ checklist_template: tower.checklistVersionId })}::jsonb, ${tower.tradeId}::uuid, ${tower.buildingA}::uuid, now())`,
  );
  item = created!.work_item_id;
  expect(await tower.outcome(c1.members.engineer, sql`select app.sync_work_item_checklists(${item}::uuid, now()) as outcome`)).toBe("synced");
  expect(await tower.take(c1.members.engineer, item, "send_for_review")).toBe("applied");
  expect(await tower.pickUp(c1.members.project_manager, item)).toBe("picked_up");
  expect(await tower.take(c1.members.project_manager, item, "submit")).toBe("applied");
  await drainOutbox(app);
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-1153-1: an item reaches K1's Consultant review pool of two", () => {
  it("tells each pool Member, of their own notification only, that it reached their pool and waits there", async () => {
    const { k1 } = tower;
    const all = await stepReachedIds();
    for (const as of [k1.members.engineer, k1.members.manager]) {
      const own = await ownStepReached(as);
      expect(own, named(as)).toHaveLength(1);
      expect(await pools(as, all), named(as)).toEqual([{ notification_id: own[0], pool: true, waiting: true }]);
    }
  });

  it("answers nothing about another Member's notifications, of K1 or of another Company", async () => {
    const { c1, k1, c2, ow } = tower;
    const managers = await ownStepReached(k1.members.manager);
    const read = (as: string) => pools(as, managers);
    await expectHiddenFrom({ read, target: managers[0]!, idOf: (r) => r.notification_id, seenBy: k1.members.manager, hiddenFrom: [k1.members.engineer, c1.members.engineer, c1.members.project_manager, c2.members.engineer, ow.members.representative], name: named });
  });

  it("once K1's Engineer picks it up: theirs reached the pool and no longer waits; the Manager's is withdrawn", async () => {
    const { k1 } = tower;
    const all = await stepReachedIds();
    expect(await tower.pickUp(k1.members.engineer, item)).toBe("picked_up");
    const own = await ownStepReached(k1.members.engineer);
    expect(await pools(k1.members.engineer, all)).toEqual([{ notification_id: own[0], pool: true, waiting: false }]);
    expect(await pools(k1.members.manager, all)).toEqual([]); // not hidden-from: withdrawn by the pick-up
  });
});

describe("scenario RP-1153-2: K1 issues Code A on C1's item, which C1's engineer watches", () => {
  beforeAll(async () => {
    const { k1 } = tower;
    expect(await tower.take(k1.members.engineer, item, "send_to_manager")).toBe("applied");
    expect(await tower.pickUp(k1.members.manager, item)).toBe("picked_up");
    expect(await tower.take(k1.members.manager, item, "approve_a")).toBe("applied");
    await drainOutbox(app);
  });

  /** What `as` reads of their notifications about the Code: its Project, outcome's name, and the Company named, as the api's read joins them. */
  const codeRead = (as: string) =>
    tower.call<{ id: string; project_code: string; outcome: string; outcome_name: { en: string } | null; company_name: { en: string } | null }>(
      as,
      sql`select n.id, p.code as project_code, e.payload ->> 'outcome' as outcome, o.name as outcome_name,
          (select c.legal_name from app.work_item_companies(n.work_item_id) c where c.participant_id = e.actor_participant_id) as company_name
        from notification n
        join project p on p.id = n.project_id
        join work_item w on w.id = n.work_item_id
        join work_item_event e on e.id = n.work_item_event_id
        left join outcome o on o.project_id = n.project_id and o.work_item_type_id = w.work_item_type_id and o.code = e.payload ->> 'outcome'
        where n.work_item_id = ${item}::uuid and n.kind = 'watched_event' and e.payload ->> 'outcome' is not null`,
    );

  it("C1's raiser reads the Code with its Project, the outcome's name and K1 by its name only", async () => {
    const [code] = await codeRead(tower.c1.members.engineer);
    expect(code).toMatchObject({ project_code: "RNP", outcome: "A", outcome_name: { en: "Approved" }, company_name: { en: "K1" } });
    expect(Object.keys(code!)).not.toContain("member_name");
  });

  it("C2 and anyone else not watching read nothing of it", async () => {
    const { c1, c2, ow } = tower;
    const [code] = await codeRead(c1.members.engineer);
    await expectHiddenFrom({ read: codeRead, target: code!.id, idOf: (r) => r.id, seenBy: c1.members.engineer, hiddenFrom: [c2.members.engineer, ow.members.representative], name: named });
  });
});
