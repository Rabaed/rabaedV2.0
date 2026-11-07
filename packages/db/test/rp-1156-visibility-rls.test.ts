// Seam 2 for the Project Visibility page (RP-1156; visibility.md V15, V16; scenario RP-1156-1), as the
// app role. The Project's Visibility Gap, the Trades and Locations no active Participant covers, is
// read by the Project's Project Admins only, and is worked out from Participant grants alone: a
// Project Member's narrower grant never opens it. Seam 1: apps/api/test/rp-1156-visibility.test.ts.
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { buildSeamTwoTower, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();

let migrator: pg.Client;
let app: Db;
let tower: SeamTwoTower;

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  // C2 covers Building B only; C1, K1 and OW cover all of it until narrowed below.
  tower = await buildSeamTwoTower(app, migrator, { projectCode: "RPG" });
});

afterAll(async () => {
  await app.destroy();
  await migrator.end();
});

type ValueRow = { kind: string; id: string };
const gap = (as: string, projectId = tower.projectId) =>
  tower.call<ValueRow>(as, sql`select kind, id from app.project_visibility_gap(${projectId}::uuid)`);
const narrowToB = (participantId: string) =>
  tower.outcome(
    tower.c1.ap,
    sql`select app.set_participant_visibility(${participantId}::uuid, 'location', false, ${[tower.buildingB]}::uuid[], now()) as outcome`,
  );

describe("scenario RP-1156-1: the Project's Visibility Gap is read by its Project Admins only, from Participant grants alone", () => {
  it("is empty while some active Participant covers every Trade and Location", async () => {
    expect(await gap(tower.c1.ap)).toEqual([]); // not hidden-from: the Project Admin's own read, which is empty (state)
  });

  it("names, to the Project Admin, the Location no active Participant covers", async () => {
    for (const p of [tower.c1.participantId, tower.k1.participantId, tower.ow.participantId]) expect(await narrowToB(p)).toBe("set");
    expect(await gap(tower.c1.ap)).toEqual([{ kind: "location", id: tower.buildingA }]);
  });

  it("is not opened by a Project Member's narrower grant: Members never count", async () => {
    // Every C2 Member is narrowed to no Location: C2 still covers Building B, so it stays closed.
    const set = await tower.outcome(
      tower.c2.ap,
      sql`select app.set_member_visibility(${tower.c2.participantId}::uuid, ${tower.c2.members.engineer}::uuid, 'location', false, '{}'::uuid[], now()) as outcome`,
    );
    expect(set).toBe("set");
    expect(await gap(tower.c1.ap)).toEqual([{ kind: "location", id: tower.buildingA }]);
  });

  it("gives nothing to anyone but the Project Admin: other Members of its Company and every other Company", async () => {
    const names = new Map([
      [tower.c1.ap, "C1's Authorized Person, the Project Admin"],
      [tower.c1.members.engineer, "C1's engineer"],
      [tower.c1.members.project_manager, "C1's Project Manager"],
      [tower.k1.ap, "K1's Authorized Person"],
      [tower.k1.members.engineer, "K1's engineer"],
      [tower.ow.ap, "OW's Authorized Person"],
      [tower.c2.ap, "C2's Authorized Person"],
      [tower.c2.members.engineer, "C2's engineer"],
    ]);
    await expectHiddenFrom({
      read: (as: string) => gap(as),
      target: tower.buildingA,
      seenBy: tower.c1.ap,
      hiddenFrom: [
        tower.c1.members.engineer,
        tower.c1.members.project_manager,
        tower.k1.ap,
        tower.k1.members.engineer,
        tower.ow.ap,
        tower.c2.ap,
        tower.c2.members.engineer,
      ],
      name: (as: string) => names.get(as) ?? as,
      label: "the Project's Visibility Gap",
    });
  });

  it("closes again when a Participant is granted the Location", async () => {
    expect(
      await tower.outcome(
        tower.c1.ap,
        sql`select app.set_participant_visibility(${tower.k1.participantId}::uuid, 'location', true, '{}'::uuid[], now()) as outcome`,
      ),
    ).toBe("set");
    expect(await gap(tower.c1.ap)).toEqual([]); // not hidden-from: the Project Admin's own read, closed again (state)
  });
});
