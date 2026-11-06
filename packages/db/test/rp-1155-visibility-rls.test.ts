// Seam 2 for the Participants pages (RP-1155; visibility.md V15, V16; scenarios RP-1155-1 to
// RP-1155-3), as the app role. Company Projects and Project Members count and list only the
// viewer's own Company's Project Members (RP-1155-1); the Visibility Gap, what a Participant
// covers that none of its Project Members do, is read by that Participant's own Authorized
// Person and nobody else (RP-1155-2); a Member added to the Project starts with all of their
// Participant's Visibility, never more (RP-1155-3). Seam 1: apps/api/test/rp-1155-visibility.test.ts.
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { bilingual, buildSeamTwoTower, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();

let migrator: pg.Client;
let app: Db;
let tower: SeamTwoTower;

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  // C2 covers Building B only (the Tower's default), all of the Trade.
  tower = await buildSeamTwoTower(app, migrator, { projectCode: "RPP" });
});

afterAll(async () => {
  await app.destroy();
  await migrator.end();
});

type ValueRow = { kind: string; id: string };
const gap = (as: string, participantId: string) =>
  tower.call<ValueRow>(as, sql`select kind, id from app.participant_visibility_gap(${participantId}::uuid)`);
const myVisibility = (as: string) =>
  tower.call<ValueRow>(as, sql`select kind, value_id as id from app.my_visibility(${tower.projectId}::uuid) order by kind, value_id`);
const memberCount = (as: string, participantId: string) =>
  tower.call<{ n: number }>(as, sql`select count(*)::int as n from project_member where participant_id = ${participantId}::uuid and status = 'active'`);

describe("scenario RP-1155-1: Company Projects and Project Members count only the viewer's own Company's Project Members", () => {
  it("C2's engineer counts C2's Project Members, and none of C1's or K1's on the same Project", async () => {
    expect(await memberCount(tower.c2.members.engineer, tower.c2.participantId)).toEqual([{ n: 1 }]);
    for (const other of [tower.c1.participantId, tower.k1.participantId, tower.ow.participantId]) {
      expect(await memberCount(tower.c2.members.engineer, other)).toEqual([{ n: 0 }]); // not hidden-from: a count, of rows RLS hides
    }
  });

  it("lists C2's own Participant on Company Projects, and no other Company's", async () => {
    const rows = await tower.call<{ participant_id: string }>(tower.c2.members.engineer, sql`select participant_id from app.company_participants()`);
    expect(rows.map((r) => r.participant_id)).toEqual([tower.c2.participantId]);
  });
});

describe("scenario RP-1155-2: the Visibility Gap is read by the Participant's own Authorized Person only", () => {
  beforeAll(async () => {
    // C2's engineer is narrowed to no Location: nobody of C2's covers Building B.
    const set = await tower.outcome(
      tower.c2.ap,
      sql`select app.set_member_visibility(${tower.c2.participantId}::uuid, ${tower.c2.members.engineer}::uuid, 'location', false, '{}'::uuid[], now()) as outcome`,
    );
    expect(set).toBe("set");
  });

  it("names, to C2's Authorized Person, what C2 covers that none of its Project Members do", async () => {
    expect(await gap(tower.c2.ap, tower.c2.participantId)).toEqual([{ kind: "location", id: tower.buildingB }]);
  });

  it("is empty for a Participant whose Project Members cover all of it", async () => {
    expect(await gap(tower.c1.ap, tower.c1.participantId)).toEqual([]); // not hidden-from: C1's own gap, which is none
  });

  it("gives nothing to C2's engineer, to the Project Admin or to another Company's Authorized Person", async () => {
    for (const as of [tower.c2.members.engineer, tower.c1.ap, tower.c1.members.engineer, tower.k1.ap, tower.ow.ap]) {
      expect(await gap(as, tower.c2.participantId), as).toEqual([]);
    }
  });
});

describe("scenario RP-1155-3: a Member added to the Project starts with all of their Participant's Visibility, never more", () => {
  let added = "";
  beforeAll(async () => {
    const { rows } = await migrator.query(
      "insert into member (company_id, email, full_name, status) values ($1, $2, $3, 'active') returning id",
      [tower.c2.id, `new-${tower.c2.cr}@rabaed.test`, JSON.stringify(bilingual("New"))],
    );
    added = rows[0].id as string;
    const outcome = await tower.outcome(
      tower.c2.ap,
      sql`select app.add_project_member(${tower.c2.participantId}::uuid, ${added}::uuid, now()) as outcome`,
    );
    expect(outcome).toBe("added");
  });

  it("covers every Trade and Building B, as C2 does, and not Building A", async () => {
    const mine = await myVisibility(added);
    expect(mine.filter((v) => v.kind === "location").map((v) => v.id)).toEqual([tower.buildingB]);
    const trades = await migrator.query(
      "select v.id from dimension_value v join visibility_dimension d on d.id = v.dimension_id where d.project_id = $1 and d.kind = 'trade'",
      [tower.projectId],
    );
    const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();
    expect(ids(mine.filter((v) => v.kind === "trade"))).toEqual(ids(trades.rows)); // C2 covers all of the Trades
    expect(mine.map((v) => v.id)).not.toContain(tower.buildingA);
  });

  it("holds 'all' in every dimension, read by C2 alone", async () => {
    const grants = sql<{ kind: string; is_all: boolean }>`select kind, is_all from app.member_grants(${tower.c2.participantId}::uuid, ${added}::uuid)`;
    expect(await tower.call(tower.c2.members.engineer, grants)).toEqual([
      { kind: "location", is_all: true },
      { kind: "trade", is_all: true },
    ]);
    expect(await tower.call(tower.c1.ap, grants)).toEqual([]); // not hidden-from: a grant read, which names no item
  });

  it("closes C2's Visibility Gap", async () => {
    expect(await gap(tower.c2.ap, tower.c2.participantId)).toEqual([]);
  });
});
