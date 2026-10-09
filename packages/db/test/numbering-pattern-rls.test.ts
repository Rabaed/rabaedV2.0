// Seam 2 for Numbering Patterns (RP-312; workflow-engine.md §8 "Settled 2026-10-05
// (Document numbering)", data-model.md numbering_pattern): every Project Member
// reads their Project's patterns and nobody writes them yet; and the first exit
// from Draft numbers the item under the pattern in effect then: the Work Item
// Type's, else the Project's, else the Rabaed Default.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { joinProject, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;

let migrator: pg.Client;
let app: Db;
let engineer = "";

type Company = { id: string; cr: string; ap: string; member: string };

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

async function member(companyId: string, who: string, creator = false): Promise<string> {
  return one(
    "insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', $4) returning id",
    [companyId, email(who), JSON.stringify({ en: who, ar: who }), creator],
  );
}

async function company(name: string): Promise<Company> {
  const cr = digits(10);
  const id = await one(
    "insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id",
    [JSON.stringify({ en: name, ar: name }), cr, `3${digits(13)}3`, engineer],
  );
  const ap = await member(id, "ap", true);
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [ap, id]);
  return { id, cr, ap, member: await member(id, "engineer") };
}

const call = <T extends object>(as: string, query: ReturnType<typeof sql<T>>) =>
  withMember(app, as, (trx) => query.execute(trx).then((r) => r.rows));

async function outcome(as: string, query: ReturnType<typeof sql<{ outcome: string }>>) {
  return (await call(as, query))[0]!.outcome;
}

/**
 * A Project with two Contractors, C1 (its creator's Company, so its Participant
 * is 01) and C2 (02), each with an engineer who covers everything; Trade EL, and
 * Location Z1 > B1 (Zone, Building).
 */
async function tower(code: string) {
  const c1 = await company("C1");
  const c2 = await company("C2");
  const [created] = await call<{ project_id: string }>(
    c1.ap,
    sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, ${code}, 'contractor')`,
  );
  const projectId = created!.project_id;
  const p1 = await one("select id from participant where project_id = $1", [projectId]);
  const p2 = await joinProject(app, projectId, { adminId: c1.ap, crNumber: c2.cr, role: "contractor" }, c2.ap);
  const value = async (kind: string, valueCode: string, parent: string | null) => {
    const [row] = await call<{ value_id: string }>(
      c1.ap,
      sql`select value_id from app.add_dimension_value(${projectId}::uuid, ${kind}, ${parent}::uuid, ${valueCode}, '{"en": "V", "ar": "ق"}'::jsonb)`,
    );
    return row!.value_id;
  };
  const trade = await value("trade", "EL", null);
  const zone = await value("location", "Z1", null);
  const building = await value("location", "B1", zone);
  const [scope] = await call<{ scope_id: string }>(
    c1.ap,
    sql`select scope_id from app.add_scope(${projectId}::uuid, ${trade}::uuid, null, '{"en": "S", "ar": "ن"}'::jsonb)`,
  );
  for (const [co, p] of [
    [c1, p1],
    [c2, p2],
  ] as const) {
    expect(await outcome(co.ap, sql`select app.add_project_member(${p}::uuid, ${co.member}::uuid, now()) as outcome`)).toBe("added");
    for (const kind of ["trade", "location"]) {
      expect(await outcome(c1.ap, sql`select app.set_participant_visibility(${p}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
      expect(
        await outcome(co.ap, sql`select app.set_member_visibility(${p}::uuid, ${co.member}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`),
      ).toBe("set");
    }
    expect(
      await outcome(co.ap, sql`select app.set_project_member_positions(${p}::uuid, ${co.member}::uuid, ${["engineer", "project_manager"]}::text[]) as outcome`),
    ).toBe("set");
  }

  /** `as` raises a MAR at `location` (B1 by default) and sends it for review; returns its Document Number. */
  async function numbered(as: string, location: string | null = building): Promise<string> {
    const [draft] = await call<{ outcome: string; work_item_id: string }>(
      as,
      sql`select outcome, work_item_id from app.create_work_item(
        ${projectId}::uuid, 'MAR', 'Cable trays', app.latest_form_version('MAR'), '{"description": "Galvanised"}'::jsonb,
        ${trade}::uuid, ${location}::uuid, now(), ${[scope!.scope_id]}::uuid[])`,
    );
    expect(draft!.outcome).toBe("created");
    const item = draft!.work_item_id;
    expect(
      await outcome(
        as,
        sql`select app.take_transition(${item}::uuid, 'send_for_review', '{}'::jsonb, '', app.answers_sha256(${item}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
      ),
    ).toBe("applied");
    return (await migrator.query("select document_number from work_item where id = $1", [item])).rows[0].document_number as string;
  }

  /** Adds a Numbering Pattern row as the migrator (nothing writes them yet), set by C1's Authorized Person. */
  async function pattern(p: {
    type?: string;
    segments: object[];
    separator?: string;
    seqDigits?: number;
    seqScope: number[];
    accepted?: boolean;
    effectiveFrom?: string;
  }) {
    await migrator.query(
      `insert into numbering_pattern (project_id, work_item_type_id, segments, separator, seq_digits, seq_scope,
         shared_counter_accepted_at, set_by_member_id, effective_from)
       values ($1, (select id from work_item_type where code = $2 and (project_id = $1 or project_id is null) order by project_id nulls last limit 1),
         $3, $4, $5, $6, case when $7 then now() end, $8, coalesce($9::timestamptz, now()))`,
      [
        projectId,
        p.type ?? null,
        JSON.stringify(p.segments),
        p.separator ?? "-",
        p.seqDigits ?? 4,
        JSON.stringify(p.seqScope),
        p.accepted ?? false,
        c1.ap,
        p.effectiveFrom ?? null,
      ],
    );
  }

  return { projectId, c1, c2, zone, building, numbered, pattern };
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  app = createDb(urls.app, { max: 2 });
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

const project = { kind: "project" };
const type = { kind: "type" };
const trade = { kind: "trade" };
const participantCode = { kind: "participant" };

describe("numbering_pattern", () => {
  it("is read by every Project Member, not only its Project Admin", async () => {
    const t = await tower("NPR");
    await t.pattern({ segments: [project, type, participantCode], seqScope: [0, 1, 2] });
    for (const who of [t.c1.ap, t.c1.member, t.c2.member]) {
      const rows = await call<{ project_id: string }>(who, sql`select project_id from numbering_pattern`);
      expect(rows.map((r) => r.project_id), who).toEqual([t.projectId]);
    }
  });

  it("is never written directly through the app role, only through app.set_numbering_pattern", async () => {
    const t = await tower("NPW");
    await expect(
      call(
        t.c1.ap,
        sql<object>`insert into numbering_pattern (project_id, segments, separator, seq_digits, seq_scope, set_by_member_id)
            values (${t.projectId}::uuid, '[{"kind": "project"}]'::jsonb, '-', 4, '[0]'::jsonb, ${t.c1.ap}::uuid)`,
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("refuses more than 6 segments, an unknown segment, or digits outside 3–7", async () => {
    const t = await tower("NPC");
    const refused = (p: Parameters<typeof t.pattern>[0]) => expect(t.pattern(p)).rejects.toThrow(/check constraint/);
    await refused({ segments: [project, type, trade, participantCode, project, type, trade], seqScope: [3] });
    await refused({ segments: [project, { kind: "building" }, participantCode], seqScope: [2] });
    await refused({ segments: [project, { kind: "location", level: 4 }, participantCode], seqScope: [2] });
    await refused({ segments: [project, participantCode], seqScope: [1], seqDigits: 2 });
    await refused({ segments: [project, participantCode], seqScope: [1], seqDigits: 8 });
    await refused({ segments: [project, participantCode], seqScope: [1], separator: "." });
    await refused({ segments: [project, participantCode], seqScope: [5] });
  });

  it("refuses a sequence not counted by the Participant Code unless the shared counter is accepted", async () => {
    const t = await tower("NPS");
    await expect(t.pattern({ segments: [project, type, participantCode], seqScope: [0, 1] })).rejects.toThrow(/check constraint/);
    await t.pattern({ segments: [project, type, participantCode], seqScope: [0, 1], accepted: true });
  });
});

describe("app.set_numbering_pattern (RP-313)", () => {
  type Saved = { work_item_type_id: string | null; set_by_member_id: string; shared_counter_accepted_at: Date | null; effective_from: Date };

  const save = (
    as: string,
    projectId: string,
    p: { type?: string | null; segments: object[]; separator?: string; seqDigits?: number; seqScope: number[]; accepted?: boolean },
  ) =>
    outcome(
      as,
      sql`select app.set_numbering_pattern(${projectId}::uuid, ${p.type ?? null}::uuid, ${JSON.stringify(p.segments)}::jsonb,
        ${p.separator ?? "-"}, ${p.seqDigits ?? 4}, ${JSON.stringify(p.seqScope)}::jsonb, ${p.accepted ?? false}, now()) as outcome`,
    );
  const saved = async (projectId: string) =>
    (
      await migrator.query(
        "select work_item_type_id, set_by_member_id, shared_counter_accepted_at, effective_from from numbering_pattern where project_id = $1 order by created_at",
        [projectId],
      )
    ).rows as Saved[];
  const mar = async () => (await migrator.query("select id from work_item_type where code = 'MAR' and project_id is null")).rows[0].id as string;

  it("saves the Project Admin's Project pattern and a Type's override, recording who set them and from when", async () => {
    const t = await tower("NSA");
    expect(await save(t.c1.ap, t.projectId, { segments: [project, type, participantCode], seqScope: [0, 1, 2] })).toBe("saved");
    expect(await save(t.c1.ap, t.projectId, { type: await mar(), segments: [type, participantCode], seqScope: [0, 1] })).toBe("saved");
    const rows = await saved(t.projectId);
    expect(rows.map((r) => [r.work_item_type_id, r.set_by_member_id, r.shared_counter_accepted_at])).toEqual([
      [null, t.c1.ap, null],
      [await mar(), t.c1.ap, null],
    ]);
    expect(rows.every((r) => r.effective_from instanceof Date)).toBe(true);
    expect(await t.numbered(t.c1.member)).toBe("MAR-01-0001");
  });

  it("answers not_found to anyone but the Project's Project Admin, and for a made-up Project", async () => {
    const t = await tower("NSN");
    const other = await tower("NSO");
    for (const [who, projectId] of [
      [t.c1.member, t.projectId],
      [t.c2.ap, t.projectId],
      [t.c2.member, t.projectId],
      [other.c1.ap, t.projectId],
      [t.c1.ap, randomUUID()],
    ] as const) {
      expect(await save(who, projectId, { segments: [project, participantCode], seqScope: [0, 1] }), who).toBe("not_found");
    }
    expect(await saved(t.projectId)).toEqual([]);
  });

  it("refuses a sequence not counted by the Participant Code until the warning is accepted, then records who accepted it and when", async () => {
    const t = await tower("NSW");
    const shared = { segments: [project, type, participantCode], seqScope: [0, 1] };
    expect(await save(t.c1.ap, t.projectId, shared)).toBe("shared_counter_not_accepted");
    expect(await saved(t.projectId)).toEqual([]);
    expect(await save(t.c1.ap, t.projectId, { ...shared, accepted: true })).toBe("saved");
    const [row] = await saved(t.projectId);
    expect(row!.set_by_member_id).toBe(t.c1.ap);
    expect(row!.shared_counter_accepted_at).toBeInstanceOf(Date);
  });

  it("records no acceptance for a pattern that counts by the Participant Code", async () => {
    const t = await tower("NSR");
    expect(await save(t.c1.ap, t.projectId, { segments: [project, participantCode], seqScope: [0, 1], accepted: true })).toBe("saved");
    expect((await saved(t.projectId))[0]!.shared_counter_accepted_at).toBeNull();
  });

  it("refuses an ill-formed pattern, and a Work Item Type the Project can't use", async () => {
    const t = await tower("NSI");
    for (const p of [
      { segments: [project, type, trade, participantCode, project, type, trade], seqScope: [3] },
      { segments: [project, { kind: "building" }, participantCode], seqScope: [2] },
      { segments: [project, participantCode], seqScope: [1], seqDigits: 2 },
      { segments: [project, participantCode], seqScope: [1], seqDigits: 8 },
      { segments: [project, participantCode], seqScope: [1], separator: "." },
      { segments: [project, participantCode], seqScope: [5] },
    ]) {
      expect(await save(t.c1.ap, t.projectId, p), JSON.stringify(p)).toBe("invalid_pattern");
    }
    expect(await save(t.c1.ap, t.projectId, { type: randomUUID(), segments: [project, participantCode], seqScope: [0, 1] })).toBe(
      "type_not_found",
    );
    expect(await saved(t.projectId)).toEqual([]);
  });
});

describe("the first exit from Draft", () => {
  it("numbers under the Rabaed Default while the Project has no pattern", async () => {
    const t = await tower("TWR");
    expect([await t.numbered(t.c1.member), await t.numbered(t.c2.member), await t.numbered(t.c1.member)]).toEqual([
      "TWR-MAR-01-0001",
      "TWR-MAR-02-0001",
      "TWR-MAR-01-0002",
    ]);
  });

  it("numbers under the Project's pattern: fixed text, Trade, Location level falling back to the item's own, '/', 5 digits", async () => {
    const t = await tower("TWP");
    await t.pattern({
      segments: [project, { kind: "text", text: "SUB" }, trade, { kind: "location", level: 3 }, participantCode],
      separator: "/",
      seqDigits: 5,
      seqScope: [0, 2, 3, 4],
    });
    expect(await t.numbered(t.c1.member)).toBe("TWP/SUB/EL/B1/01/00001");
    expect(await t.numbered(t.c1.member)).toBe("TWP/SUB/EL/B1/01/00002");
    // At the Zone, a different Location: its own count.
    expect(await t.numbered(t.c1.member, t.zone)).toBe("TWP/SUB/EL/Z1/01/00001");
  });

  it("prints the Location at the chosen level, above the item's own", async () => {
    const t = await tower("TWL");
    await t.pattern({ segments: [project, { kind: "location", level: 1 }, participantCode], seqScope: [0, 1, 2] });
    expect(await t.numbered(t.c1.member)).toBe("TWL-Z1-01-0001");
  });

  it("prefers the Work Item Type's pattern over the Project's", async () => {
    const t = await tower("TWT");
    await t.pattern({ type: "MAR", segments: [type, participantCode], seqScope: [0, 1] });
    await t.pattern({ segments: [project, participantCode], seqScope: [0, 1] });
    expect(await t.numbered(t.c1.member)).toBe("MAR-01-0001");
  });

  it("uses the newest pattern in effect, never one not yet in effect", async () => {
    const t = await tower("TWE");
    await t.pattern({ segments: [project, type, participantCode], seqScope: [0, 1, 2], effectiveFrom: "2026-01-01T00:00:00Z" });
    await t.pattern({ segments: [type, project, participantCode], seqScope: [0, 1, 2], effectiveFrom: "2026-02-01T00:00:00Z" });
    await t.pattern({ segments: [participantCode, project], seqScope: [0, 1], effectiveFrom: "2999-01-01T00:00:00Z" });
    expect(await t.numbered(t.c1.member)).toBe("MAR-TWE-01-0001");
  });

  it("shares one count between Companies when the accepted pattern doesn't count by the Participant Code", async () => {
    const t = await tower("TWS");
    await t.pattern({ segments: [project, type, participantCode], seqScope: [0, 1], accepted: true });
    expect([await t.numbered(t.c1.member), await t.numbered(t.c2.member), await t.numbered(t.c1.member)]).toEqual([
      "TWS-MAR-01-0001",
      "TWS-MAR-02-0002",
      "TWS-MAR-01-0003",
    ]);
  });

  it("continues a count when a new pattern counts by the same values", async () => {
    const t = await tower("TWC");
    expect(await t.numbered(t.c1.member)).toBe("TWC-MAR-01-0001");
    await t.pattern({ segments: [project, type, participantCode], separator: "/", seqDigits: 5, seqScope: [0, 1, 2] });
    expect(await t.numbered(t.c1.member)).toBe("TWC/MAR/01/00002");
  });
});

describe("a Custom pattern given up (RP-412 rebuild)", () => {
  const mar = async () => (await migrator.query("select id from work_item_type where code = 'MAR' and project_id is null")).rows[0].id as string;
  const use = (as: string, projectId: string, typeId: string | null) =>
    outcome(as, sql`select app.set_numbering_pattern(${projectId}::uuid, ${typeId}::uuid, null, null, null, null, false, now()) as outcome`);

  it("numbers the Type under the Project's pattern again, keeping the Custom pattern as history", async () => {
    const t = await tower("TWU");
    await t.pattern({ segments: [project, participantCode], seqScope: [0, 1] });
    await t.pattern({ type: "MAR", segments: [type, participantCode], seqScope: [0, 1] });
    expect(await t.numbered(t.c1.member)).toBe("MAR-01-0001");
    expect(await use(t.c1.ap, t.projectId, await mar())).toBe("saved");
    expect(await t.numbered(t.c1.member)).toBe("TWU-01-0001");
    const rows = (await migrator.query("select follows_project, segments from numbering_pattern where project_id = $1 order by created_at", [t.projectId]))
      .rows;
    expect(rows.map((r) => [r.follows_project, r.segments === null])).toEqual([
      [false, false],
      [false, false],
      [true, true],
    ]);
  });

  it("falls back to the Rabaed Default when the Project has no pattern of its own", async () => {
    const t = await tower("TWD");
    await t.pattern({ type: "MAR", segments: [type, participantCode], seqScope: [0, 1] });
    expect(await use(t.c1.ap, t.projectId, await mar())).toBe("saved");
    expect(await t.numbered(t.c1.member)).toBe("TWD-MAR-01-0001");
  });

  it("is refused for the Project's own pattern, and to anyone but the Project Admin", async () => {
    const t = await tower("TWN");
    expect(await use(t.c1.ap, t.projectId, null)).toBe("invalid_pattern");
    expect(await use(t.c1.member, t.projectId, await mar())).toBe("not_found");
    expect(await use(t.c2.member, t.projectId, await mar())).toBe("not_found");
  });
});

describe("app.numbering_pattern_versions (visibility.md RP-412-3)", () => {
  type Version = { work_item_type_id: string | null; version_no: number; by_rabaed: boolean; company_name: unknown; member_name: unknown };
  const versions = (as: string, projectId: string) =>
    call<Version>(
      as,
      sql`select work_item_type_id, version_no, by_rabaed, company_name, member_name from app.numbering_pattern_versions(${projectId}::uuid, now())`,
    );

  it("names a saver's Company outside the Host Company only to its own Members and the Project Admins, and the saver only within it", async () => {
    const t = await tower("TWV");
    // C2's engineer is made a Project Admin too: a saver whose Company isn't the Host Company.
    await migrator.query("insert into project_admin (project_id, member_id, appointed_by_member_id) values ($1, $2, $3)", [
      t.projectId,
      t.c2.member,
      t.c1.ap,
    ]);
    expect(
      await outcome(
        t.c2.member,
        sql`select app.set_numbering_pattern(${t.projectId}::uuid, null, '[{"kind": "project"}, {"kind": "participant"}]'::jsonb, '-', 4, '[0, 1]'::jsonb, false, now()) as outcome`,
      ),
    ).toBe("saved");
    // And a Rabaed Engineer's save through Rabaed Admin.
    const action = await one(
      "insert into admin_action (engineer_id, action, target_kind, target_id, reason) values ($1, 'set_numbering_pattern', 'project', $2, 'Seam two') returning id",
      [engineer, t.projectId],
    );
    await migrator.query(
      `insert into numbering_pattern (project_id, segments, separator, seq_digits, seq_scope, admin_action_id)
       values ($1, '[{"kind": "participant"}]'::jsonb, '-', 4, '[0]'::jsonb, $2)`,
      [t.projectId, action],
    );

    const c2Name = { en: "C2", ar: "C2" };
    const c2Saver = { en: "engineer", ar: "engineer" };
    const rabaed = { work_item_type_id: null, version_no: 2, by_rabaed: true, company_name: null, member_name: null };
    // C1's engineer: the Host Company's, neither a Project Admin nor C2's.
    expect(await versions(t.c1.member, t.projectId)).toEqual([
      rabaed,
      { work_item_type_id: null, version_no: 1, by_rabaed: false, company_name: null, member_name: null },
    ]);
    // A Project Admin sees every Participant (V15), but another Company's people only by name of the Company (V14).
    expect((await versions(t.c1.ap, t.projectId))[1]).toEqual({ work_item_type_id: null, version_no: 1, by_rabaed: false, company_name: c2Name, member_name: null });
    // C2's own Members.
    expect((await versions(t.c2.member, t.projectId))[1]).toMatchObject({ company_name: c2Name, member_name: c2Saver });
  });

  it("returns nothing to anyone outside the Project", async () => {
    const t = await tower("TWO");
    const other = await tower("TWQ");
    await t.pattern({ segments: [project, participantCode], seqScope: [0, 1] });
    expect(await versions(other.c1.ap, t.projectId)).toEqual([]);
  });
});
