// Seam 2 for scenario RP-381-1 (visibility.md V15, side channels): a Member who isn't a Project
// Admin reads only their own Company's Participant, and its order on the Project is theirs only
// through a Project Admin. Orders are given out max+1, so even a Participant's own order would count
// the other Participants. Seam 1 is apps/api/test/participants.test.ts.
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { buildSeamTwoTower, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
let migrator: pg.Client;
let app: Db;
let t: SeamTwoTower<{ k1Manager: true }>;
let names: Map<string, string>;

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  t = await buildSeamTwoTower(app, migrator, { projectCode: "ROD", k1Manager: true });
  names = new Map([
    [t.c1.ap, "C1's Project Admin"],
    [t.c1.members.engineer, "C1 engineer"],
    [t.k1.members.manager, "K1 manager"],
  ]);
}, 60_000);

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

const name = (member: string) => names.get(member) ?? member;

/** The Tower's Participants `member` reads, as the API's Participants read does: each with its code, and its order only for a Project Admin. */
const participantsOf = (member: string) =>
  t.call<{ id: string; code: string | null; ordinal: number | null }>(
    member,
    sql`select p.participant_id as id, pt.code,
          case when ${t.projectId}::uuid in (select app.current_admin_project_ids()) then pt.ordinal end as ordinal
        from app.project_participants(${t.projectId}::uuid) p
        join participant pt on pt.id = p.participant_id`,
  );

describe("scenario RP-381-1: the Tower's Participants have no Participant Code; K1's manager and a C1 engineer open the Participants", () => {
  it("has no Participant Code on any of them, and the Project Admin gets every order", async () => {
    const all = await participantsOf(t.c1.ap);
    expect(all.map((p) => p.id).sort()).toEqual([t.c1.participantId, t.k1.participantId, t.ow.participantId, t.c2.participantId].sort());
    for (const p of all) {
      expect(p.code, p.id).toBeNull();
      expect(p.ordinal, p.id).toEqual(expect.any(Number));
    }
  });

  it("gives each their own Participant, without its order, and no other Participant", async () => {
    for (const [member, own] of [
      [t.k1.members.manager, t.k1.participantId],
      [t.c1.members.engineer, t.c1.participantId],
    ] as const) {
      expect(await participantsOf(member), name(member)).toEqual([{ id: own, code: null, ordinal: null }]);
    }
    // By id: each Participant is read by its own Company's Member and the Project Admin, never by the other Company's.
    await expectHiddenFrom({ read: participantsOf, target: t.k1.participantId, seenBy: [t.k1.members.manager, t.c1.ap], hiddenFrom: t.c1.members.engineer, name });
    await expectHiddenFrom({ read: participantsOf, target: t.c1.participantId, seenBy: [t.c1.members.engineer, t.c1.ap], hiddenFrom: t.k1.members.manager, name });
    for (const other of [t.ow.participantId, t.c2.participantId]) {
      await expectHiddenFrom({ read: participantsOf, target: other, seenBy: t.c1.ap, hiddenFrom: [t.k1.members.manager, t.c1.members.engineer], name });
    }
  });

  it("reads the Participant rows themselves the same way: another Company's row is not there at all", async () => {
    const rows = (member: string) => t.call<{ id: string }>(member, sql`select id from participant where project_id = ${t.projectId}::uuid`);
    await expectHiddenFrom({ read: rows, target: t.k1.participantId, seenBy: [t.k1.members.manager, t.c1.ap], hiddenFrom: t.c1.members.engineer, name, label: "participant table" });
    await expectHiddenFrom({ read: rows, target: t.c1.participantId, seenBy: [t.c1.members.engineer, t.c1.ap], hiddenFrom: t.k1.members.manager, name, label: "participant table" });
  });

  it("counts the Tower among the Project Admin's admin Projects only, which is what gives the order", async () => {
    const adminOf = (member: string) => t.call<{ id: string }>(member, sql`select app.current_admin_project_ids() as id`);
    await expectHiddenFrom({ read: adminOf, target: t.projectId, seenBy: t.c1.ap, hiddenFrom: [t.k1.members.manager, t.c1.members.engineer], name, label: "admin Projects" });
  });
});
