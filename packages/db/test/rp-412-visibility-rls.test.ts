// Seam 2 for the Numbering page's versions and counters (RP-412 rebuild, spec RP-447; visibility.md V14,
// V15, scenario 55, scenarios RP-412-1 and RP-412-2), as the app role. app.numbering_pattern_versions gives
// every Project Member every version of the patterns, naming the saver's Company to its own Members and the
// Project Admins only (the Host Company is no exception) and the saver within their own Company only.
// numbering_counter (RLS), app.numbering_counter and app.set_numbering_counter_start answer the Project
// Admins only; anyone else reads no counter and gets the plain not_found. RP-412-3 is in
// numbering-pattern-rls.test.ts. Seam 1 (what the page shows, its preview and examples, new MARs numbered
// under the Project pattern): apps/api/test/numbering.test.ts.
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { buildSeamTwoTower, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const towerOptions = { k1Manager: true, checklistTemplate: false } as const;
type Tower = SeamTwoTower<typeof towerOptions>;

let migrator: pg.Client;
let app: Db;

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

/** Who each reader is, for a failure. */
const namer = (t: Tower) => {
  const names = new Map<string, string>([
    [t.c1.ap, "C1's Project Admin"],
    [t.c1.members.engineer, "C1's engineer"],
    [t.c1.members.project_manager, "C1's PM"],
    [t.c2.members.engineer, "C2's engineer"],
    [t.k1.members.manager, "K1's manager"],
  ]);
  return (as: string) => names.get(as) ?? as;
};

const marId = async () => (await migrator.query("select id from work_item_type where code = 'MAR' and project_id is null")).rows[0].id as string;

type Version = {
  work_item_type_id: string | null;
  version_no: number;
  effective_from: Date;
  follows_project: boolean;
  segments: unknown;
  separator: string | null;
  seq_digits: number | null;
  seq_scope: unknown;
  by_rabaed: boolean;
  company_name: unknown;
  member_name: unknown;
};

describe("scenario RP-412-1: the versions of the Tower's patterns, saved by the Host Company's Project Admin", () => {
  let t: Tower;
  let mar = "";
  let named: (as: string) => string;
  let c1Name: unknown;
  let saverName: unknown;
  const versions = (as: string) => t.call<Version>(as, sql`select * from app.numbering_pattern_versions(${t.projectId}::uuid, now())`);
  const save = (segments: object[] | null, typeId: string | null = null) =>
    t.outcome(
      t.c1.ap,
      sql`select app.set_numbering_pattern(${t.projectId}::uuid, ${typeId}::uuid, ${segments === null ? null : JSON.stringify(segments)}::jsonb,
        ${segments === null ? null : "-"}, ${segments === null ? null : 4}::integer, ${segments === null ? null : JSON.stringify(segments.map((_, i) => i))}::jsonb, false, now()) as outcome`,
    );

  beforeAll(async () => {
    t = await buildSeamTwoTower(app, migrator, { ...towerOptions, projectCode: "NVR" });
    named = namer(t);
    mar = await marId();
    expect(await save([{ kind: "project" }, { kind: "type" }, { kind: "participant" }])).toBe("saved");
    expect(await save([{ kind: "type" }, { kind: "project" }, { kind: "participant" }])).toBe("saved");
    expect(await save([{ kind: "type" }, { kind: "participant" }], mar)).toBe("saved");
    // "Use Project pattern": the MAR's Custom pattern stays as a version.
    expect(await save(null, mar)).toBe("saved");
    c1Name = (await migrator.query("select legal_name from company where id = $1", [t.c1.id])).rows[0].legal_name;
    saverName = (await migrator.query("select full_name from member where id = $1", [t.c1.ap])).rows[0].full_name;
  });

  const readers = () => [t.c1.ap, t.c1.members.engineer, t.c2.members.engineer, t.k1.members.manager];

  it("gives each reader every version: its number, when it took effect and the pattern", async () => {
    const admin = (await versions(t.c1.ap)).map(({ company_name: _c, member_name: _m, ...v }) => v);
    expect(admin.map((v) => [v.work_item_type_id, v.version_no, v.follows_project])).toEqual([
      [null, 2, false],
      [null, 1, false],
      [mar, 2, true],
      [mar, 1, false],
    ]);
    expect(admin.find((v) => v.work_item_type_id === mar && v.version_no === 1)).toMatchObject({ segments: [{ kind: "type" }, { kind: "participant" }], separator: "-", seq_digits: 4 });
    for (const as of readers()) {
      expect((await versions(as)).map(({ company_name: _c, member_name: _m, ...v }) => v), named(as)).toEqual(admin);
    }
  });

  it("names C1 as the saver's Company to C1's Members and the Project Admin, and to neither C2 nor K1, though C1 is the Host Company (V15)", async () => {
    // Every version's saver is C1's Project Admin; a version names a Company only by its legal name, so the
    // read gives C1's id for a version whose Company is C1's, and any other Company's as itself.
    const companyOf = (name: unknown) => (JSON.stringify(name) === JSON.stringify(c1Name) ? t.c1.id : JSON.stringify(name));
    await expectHiddenFrom({
      read: async (as: string) => (await versions(as)).filter((v) => v.company_name !== null).map((v) => ({ id: companyOf(v.company_name) })),
      target: t.c1.id,
      seenBy: [t.c1.ap, t.c1.members.engineer, t.c1.members.project_manager],
      hiddenFrom: [t.c2.members.engineer, t.k1.members.manager],
      name: named,
      label: "the saver's Company",
    });
    for (const as of [t.c1.ap, t.c1.members.engineer]) {
      for (const v of await versions(as)) expect(v.company_name, named(as)).toEqual(c1Name);
    }
    // C2 and K1 read "A Project Admin": no Company, and not Rabaed's either.
    for (const as of [t.c2.members.engineer, t.k1.members.manager]) {
      for (const v of await versions(as)) expect([v.company_name, v.by_rabaed], named(as)).toEqual([null, false]);
    }
  });

  it("names the saver to C1's Members only, and gives nobody the saver's id (V14)", async () => {
    await expectHiddenFrom({
      read: async (as: string) =>
        (await versions(as)).filter((v) => JSON.stringify(v.member_name) === JSON.stringify(saverName)).map(() => ({ id: t.c1.ap })),
      target: t.c1.ap,
      seenBy: [t.c1.ap, t.c1.members.engineer],
      hiddenFrom: [t.c2.members.engineer, t.k1.members.manager],
      name: named,
      label: "the saver's name",
    });
    for (const as of [t.c2.members.engineer, t.k1.members.manager]) {
      for (const v of await versions(as)) expect(v.member_name, named(as)).toBeNull();
    }
    // No column carries a person's id, not even to the Project Admin, who reads the name.
    for (const as of readers()) {
      const rows = await versions(as);
      expect(Object.keys(rows[0]!).sort(), named(as)).toEqual([
        "by_rabaed", "company_name", "effective_from", "follows_project", "member_name", "segments", "separator", "seq_digits", "seq_scope", "version_no", "work_item_type_id",
      ]);
      expect(JSON.stringify(rows).includes(t.c1.ap), named(as)).toBe(false);
    }
  });
});

describe("scenario RP-412-2: C1 has issued two MAR numbers; the counters are its Project Admin's alone (scenario 55)", () => {
  let t: Tower;
  let named: (as: string) => string;
  let counterKey = "";
  const nonAdmins = () => [t.c1.members.engineer, t.c2.members.engineer, t.k1.members.manager];
  type Counter = { outcome: string; counter_key: string | null; last_value: number | null; issued: boolean | null };
  const counter = (as: string, projectId = t.projectId) =>
    t.call<Counter>(
      as,
      sql`select outcome, counter_key, last_value, issued from app.numbering_counter(${projectId}::uuid, 'MAR', ${t.c1.participantId}::uuid, null, null, now())`,
    );
  const setStart = (as: string, projectId = t.projectId) =>
    t.call<{ outcome: string; counter_key: string | null; next_number: string | null }>(
      as,
      sql`select outcome, counter_key, next_number from app.set_numbering_counter_start(${projectId}::uuid, 'MAR', ${t.c1.participantId}::uuid, null, null, 500, now())`,
    );

  beforeAll(async () => {
    t = await buildSeamTwoTower(app, migrator, { ...towerOptions, projectCode: "NVC" });
    named = namer(t);
    const [scope] = await t.call<{ scope_id: string }>(
      t.c1.ap,
      sql`select scope_id from app.add_scope(${t.projectId}::uuid, ${t.tradeId}::uuid, null, '{"en": "S", "ar": "ن"}'::jsonb)`,
    );
    for (const title of ["Cable trays", "Busbars"]) {
      const [draft] = await t.call<{ outcome: string; work_item_id: string }>(
        t.c1.members.engineer,
        sql`select outcome, work_item_id from app.create_work_item(
          ${t.projectId}::uuid, 'MAR', ${title}, app.latest_form_version('MAR'), '{"description": "Galvanised"}'::jsonb,
          ${t.tradeId}::uuid, ${t.buildingA}::uuid, now(), ${[scope!.scope_id]}::uuid[])`,
      );
      expect(draft!.outcome).toBe("created");
      expect(await t.take(t.c1.members.engineer, draft!.work_item_id, "send_for_review")).toBe("applied");
    }
    counterKey = (await migrator.query("select counter_key from numbering_counter where project_id = $1", [t.projectId])).rows[0].counter_key as string;
  });

  it("gives the counter rows to the Project Admin, at 2, and to none of the others (RLS)", async () => {
    const rows = (as: string) => t.call<{ counter_key: string; last_value: number }>(as, sql`select counter_key, last_value from numbering_counter where project_id = ${t.projectId}::uuid`);
    expect(await rows(t.c1.ap)).toEqual([{ counter_key: counterKey, last_value: 2 }]);
    await expectHiddenFrom({
      read: rows,
      target: counterKey,
      seenBy: t.c1.ap,
      hiddenFrom: nonAdmins(),
      idOf: (r) => r.counter_key,
      name: named,
      label: "numbering_counter",
    });
  });

  it("previews the counter for the Project Admin only, with its real last value; the others get the plain not_found", async () => {
    expect(await counter(t.c1.ap)).toEqual([{ outcome: "found", counter_key: counterKey, last_value: 2, issued: true }]);
    await expectHiddenFrom({
      read: async (as: string) => (await counter(as)).filter((r) => r.outcome === "found").map((r) => ({ id: r.counter_key! })),
      target: counterKey,
      seenBy: t.c1.ap,
      hiddenFrom: nonAdmins(),
      name: named,
      label: "app.numbering_counter",
    });
    // The same refusal as a made-up Project: no key, no value, nothing issued.
    const refused = await counter(t.c1.ap, randomUUID());
    expect(refused).toEqual([{ outcome: "not_found", counter_key: null, last_value: null, issued: null }]);
    for (const as of nonAdmins()) expect(await counter(as), named(as)).toEqual(refused);
  });

  it("tells the Project Admin the counter is used, and the others only not_found, setting nothing", async () => {
    expect(await setStart(t.c1.ap)).toEqual([{ outcome: "counter_used", counter_key: null, next_number: null }]);
    const refused = await setStart(t.c1.ap, randomUUID());
    expect(refused).toEqual([{ outcome: "not_found", counter_key: null, next_number: null }]);
    for (const as of nonAdmins()) expect(await setStart(as), named(as)).toEqual(refused);
    expect((await migrator.query("select last_value from numbering_counter where project_id = $1", [t.projectId])).rows).toEqual([{ last_value: 2 }]);
  });
});
