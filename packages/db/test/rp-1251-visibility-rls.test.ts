// Seam 2 for the settings that pick a Trade or Location (RP-1251, a follow-up to RP-1239; visibility.md
// V15; scenarios RP-1251-1 to RP-1251-3), as the app role. The Approved Supplier List, the Checklist
// Templates and the numbering counters' starting numbers never take a deactivated ("archived") Trade or
// Location as a new choice; a supplier or template that already has one keeps it, read as before by the
// Project's Members only. Everyone but the Project Admin still gets `not_found`. Seam 1:
// apps/api/test/rp-1251-visibility.test.ts.
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { bilingual, buildSeamTwoTower, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const towerOptions = { projectCode: "RAS", otherProject: true } as const;

let migrator: pg.Client;
let app: Db;
let tower: SeamTwoTower<typeof towerOptions>;
// Two Trades of the Tower's: one archived after a supplier and a template took it, one archived first.
let kept = "";
let archived = "";

const add = async (kind: string, code: string): Promise<string> => {
  const [row] = await tower.call<{ outcome: string; value_id: string }>(
    tower.c1.ap,
    sql`select outcome, value_id from app.add_dimension_value(${tower.projectId}::uuid, ${kind}, null, ${code}, ${JSON.stringify(bilingual(code))}::jsonb)`,
  );
  if (row!.outcome !== "added") throw new Error(`add ${code}: ${row!.outcome}`);
  return row!.value_id;
};

const archive = async (kind: string, id: string) =>
  expect(await tower.outcome(tower.c1.ap, sql`select app.update_dimension_value(${id}::uuid, ${kind}, null, false, now()) as outcome`)).toBe("updated");

const addSupplier = async (as: string, trade: string, en: string) =>
  (
    await tower.call<{ outcome: string; supplier_id: string | null }>(
      as,
      sql`select outcome, supplier_id from app.add_approved_supplier(${tower.projectId}::uuid, ${trade}::uuid, null, ${JSON.stringify(bilingual(en))}::jsonb, now())`,
    )
  )[0]!;

const items = JSON.stringify([{ key: "formwork", text: { en: "Formwork tight", ar: "القوالب محكمة" }, answers: "pass_fail_na", comment: "optional", photo: "off", on_negative: "create_snag" }]);

const createTemplate = async (as: string, trade: string, en: string) =>
  (
    await tower.call<{ outcome: string; template_id: string | null }>(
      as,
      sql`select outcome, template_id from app.create_checklist_template(${tower.projectId}::uuid, ${JSON.stringify(bilingual(en))}::jsonb, ${trade}::uuid, ${items}::jsonb, now())`,
    )
  )[0]!;

const editTemplate = (as: string, id: string, trade: string, en: string) =>
  tower.outcome(as, sql`select outcome from app.edit_checklist_template(${id}::uuid, ${JSON.stringify(bilingual(en))}::jsonb, ${trade}::uuid, ${items}::jsonb, now())`);

const startCounter = (as: string, trade: string | null, location: string | null) =>
  tower.outcome(
    as,
    sql`select outcome from app.set_numbering_counter_start(${tower.projectId}::uuid, 'MAR', ${tower.c1.participantId}::uuid, ${trade}::uuid, ${location}::uuid, 500, now())`,
  );

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  kept = await add("trade", "KPT");
  archived = await add("trade", "ARC");
  await archive("trade", archived);
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

const everyoneElse = () => [tower.c1.members.engineer, tower.k1.ap, tower.ow.ap, tower.c2.ap, tower.other.ap];

describe("scenario RP-1251-1: the Approved Supplier List never takes an archived Trade anew; a supplier on one keeps it", () => {
  let supplier = "";

  beforeAll(async () => {
    const added = await addSupplier(tower.c1.ap, kept, "Gulf Steel");
    expect(added.outcome).toBe("added");
    supplier = added.supplier_id!;
    await archive("trade", kept);
  });

  it("refuses the Project Admin a supplier on an archived Trade, as for a Trade that isn't the Project's", async () => {
    expect((await addSupplier(tower.c1.ap, archived, "Red Sea Cement")).outcome).toBe("trade_not_found");
    expect((await addSupplier(tower.c1.ap, kept, "Najd Rebar")).outcome).toBe("trade_not_found");
    expect((await addSupplier(tower.c1.ap, tower.tradeId, "Najd Rebar")).outcome).toBe("added");
  });

  it("names nothing to anyone else: they get not_found for an active Trade too", async () => {
    for (const as of everyoneElse()) expect((await addSupplier(as, tower.tradeId, "Hidden Supplies")).outcome).toBe("not_found");
  });

  it("keeps the supplier on its archived Trade, read by the Project's Members and no one else", async () => {
    await expectHiddenFrom({
      read: (as: string) => tower.call<{ id: string }>(as, sql`select id from approved_supplier where id = ${supplier}::uuid and trade_value_id = ${kept}::uuid`),
      target: supplier,
      seenBy: [tower.c1.ap, tower.k1.members.engineer],
      hiddenFrom: [tower.other.ap],
      label: "a supplier on an archived Trade",
    });
  });
});

describe("scenario RP-1251-2: a Checklist Template never takes an archived Trade anew; one on it keeps it", () => {
  let template = "";
  // The template's own Trade, archived after the template took it.
  let ownTrade = "";

  beforeAll(async () => {
    ownTrade = await add("trade", "TPL");
    const created = await createTemplate(tower.c1.ap, ownTrade, "Slab checks");
    expect(created.outcome).toBe("created");
    template = created.template_id!;
    await archive("trade", ownTrade);
  });

  it("refuses a new template on an archived Trade, and accepts one on an active Trade", async () => {
    expect((await createTemplate(tower.c1.ap, archived, "Column checks")).outcome).toBe("trade_not_found");
    expect((await createTemplate(tower.c1.ap, tower.tradeId, "Column checks")).outcome).toBe("created");
  });

  it("lets the template keep its own archived Trade on an edit, but never move to another archived one", async () => {
    expect(await editTemplate(tower.c1.ap, template, ownTrade, "Slab checks v2")).toBe("edited");
    expect(await editTemplate(tower.c1.ap, template, archived, "Slab checks v3")).toBe("trade_not_found");
    expect(await editTemplate(tower.c1.ap, template, tower.tradeId, "Slab checks v3")).toBe("edited");
    // Once off it, the archived Trade is a new choice again, so it is refused.
    expect(await editTemplate(tower.c1.ap, template, ownTrade, "Slab checks v4")).toBe("trade_not_found");
  });

  it("names nothing to anyone else: they get not_found for an active Trade too", async () => {
    for (const as of everyoneElse()) {
      expect((await createTemplate(as, tower.tradeId, "Hidden checks")).outcome).toBe("not_found");
      expect(await editTemplate(as, template, tower.tradeId, "Hidden checks")).toBe("not_found");
    }
  });
});

describe("scenario RP-1251-3: a numbering counter's starting number is never set on an archived Trade or Location", () => {
  let zone = "";

  beforeAll(async () => {
    zone = await add("location", "ZAR");
    await archive("location", zone);
  });

  it("refuses the Project Admin an archived Trade or Location, as for a value that isn't the Project's", async () => {
    expect(await startCounter(tower.c1.ap, archived, null)).toBe("value_not_found");
    expect(await startCounter(tower.c1.ap, null, zone)).toBe("value_not_found");
    expect(await startCounter(tower.c1.ap, tower.tradeId, tower.buildingA)).toBe("set");
  });

  it("names nothing to anyone else: they get not_found for active values too", async () => {
    for (const as of everyoneElse()) expect(await startCounter(as, tower.tradeId, tower.buildingA)).toBe("not_found");
  });
});
