// Seam 2 for a Document Number's segments (RP-1065, spec RP-1054 C4; GLOSSARY "Document
// Number", "Numbering Pattern", "Version"; visibility.md, Document Numbers, scenario
// RP-1065-1). `app.work_item_number_segments` names what each part of an item's number is,
// from the Numbering Pattern Version it was numbered under, for whoever sees the item; it
// carries only what the number already prints: no counter, no other Company's volume.
import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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
type Segments = { separator: string; segments: { kind: string; value: string; level?: number }[] } | null;

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

/** What `as` reads of the item's number segments. */
async function segmentsOf(as: string, item: string): Promise<Segments> {
  const [row] = await call<{ segments: Segments }>(as, sql`select app.work_item_number_segments(${item}::uuid) as segments`);
  return row!.segments;
}

/**
 * A Project of C1's (its Authorized Person created it and is its Project Admin; its
 * Participant is 01) with C2 (02) and K1, a Consultant; everyone covers everything.
 * Trade EL, Location Z1 > B1.
 */
async function tower(code: string) {
  const c1 = await company("C1");
  const c2 = await company("C2");
  const k1 = await company("K1");
  const [created] = await call<{ project_id: string }>(
    c1.ap,
    sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, ${code}, 'contractor')`,
  );
  const projectId = created!.project_id;
  const p1 = await one("select id from participant where project_id = $1", [projectId]);
  const p2 = await joinProject(app, projectId, { adminId: c1.ap, crNumber: c2.cr, role: "contractor" }, c2.ap);
  const pk = await joinProject(app, projectId, { adminId: c1.ap, crNumber: k1.cr, role: "consultant" }, k1.ap);
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
  for (const [co, p, positions] of [
    [c1, p1, ["engineer", "project_manager"]],
    [c2, p2, ["engineer", "project_manager"]],
    [k1, pk, ["engineer", "manager"]],
  ] as const) {
    expect(await outcome(co.ap, sql`select app.add_project_member(${p}::uuid, ${co.member}::uuid, now()) as outcome`)).toBe("added");
    for (const kind of ["trade", "location"]) {
      expect(await outcome(c1.ap, sql`select app.set_participant_visibility(${p}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
      expect(
        await outcome(co.ap, sql`select app.set_member_visibility(${p}::uuid, ${co.member}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`),
      ).toBe("set");
    }
    expect(
      await outcome(co.ap, sql`select app.set_project_member_positions(${p}::uuid, ${co.member}::uuid, ${[...positions]}::text[]) as outcome`),
    ).toBe("set");
  }

  /** `as` raises a MAR in B1, a Draft; returns its id. */
  async function drafted(as: string): Promise<string> {
    const [draft] = await call<{ outcome: string; work_item_id: string }>(
      as,
      sql`select outcome, work_item_id from app.create_work_item(
        ${projectId}::uuid, 'MAR', 'Cable trays', app.latest_form_version('MAR'), '{"description": "Galvanised"}'::jsonb,
        ${trade}::uuid, ${building}::uuid, now(), ${[scope!.scope_id]}::uuid[])`,
    );
    expect(draft!.outcome).toBe("created");
    return draft!.work_item_id;
  }

  /** `as` takes `transition` on the item, which they hold. */
  async function takes(as: string, item: string, transition: string) {
    expect(
      await outcome(
        as,
        sql`select app.take_transition(${item}::uuid, ${transition}, '{}'::jsonb, '', app.answers_sha256(${item}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
      ),
    ).toBe("applied");
  }

  /** `as` raises a MAR in B1 and sends it for review; returns its id and Document Number. */
  async function numbered(as: string): Promise<{ id: string; number: string }> {
    const id = await drafted(as);
    await takes(as, id, "send_for_review");
    const number = (await migrator.query("select document_number from work_item where id = $1", [id])).rows[0].document_number as string;
    return { id, number };
  }

  /** Adds a Numbering Pattern row as the migrator, set by C1's Authorized Person. */
  async function pattern(segments: object[], seqScope: number[], seqDigits = 4, separator = "-") {
    await migrator.query(
      `insert into numbering_pattern (project_id, segments, separator, seq_digits, seq_scope, shared_counter_accepted_at, set_by_member_id)
       values ($1, $2, $3, $4, $5, now(), $6)`,
      [projectId, JSON.stringify(segments), separator, seqDigits, JSON.stringify(seqScope), c1.ap],
    );
  }

  return { projectId, c1, c2, k1, p1, p2, trade, zone, building, drafted, takes, numbered, pattern };
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

type Case = {
  name: string;
  pattern: { segments: object[]; separator: string; seqDigits: number };
  item: { projectCode: string; typeCode: string; tradeCode: string | null; participant: { code: string | null; ordinal: number }; locationPath: string[] };
  seq: number;
  number: string;
};
const cases = JSON.parse(readFileSync(new URL("../../domain/src/numbering-cases.json", import.meta.url), "utf8")) as Case[];

describe("app.document_number_parts, the shared cases", () => {
  it.each(cases)("$name: its parts and the sequence make the number", async ({ pattern, item, seq, number }) => {
    const attributes = {
      project_code: item.projectCode,
      type_code: item.typeCode,
      trade_code: item.tradeCode,
      participant_code: item.participant.code,
      participant_ordinal: item.participant.ordinal,
      location_path: item.locationPath,
    };
    const { rows } = await migrator.query<{ parts: { value: string }[] }>("select app.document_number_parts($1::jsonb, $2::jsonb) as parts", [
      JSON.stringify(pattern.segments),
      JSON.stringify(attributes),
    ]);
    const sequence = String(seq).padStart(pattern.seqDigits, "0");
    expect([...rows[0]!.parts.map((p) => p.value), sequence].join(pattern.separator)).toBe(number);
  });
});

describe("app.work_item_number_segments", () => {
  it("names each part of a number issued under the Rabaed Default, the sequence last", async () => {
    const t = await tower("NSD");
    const { id, number } = await t.numbered(t.c1.member);
    expect(number).toBe("NSD-MAR-01-0001");
    expect(await segmentsOf(t.c1.member, id)).toEqual({
      separator: "-",
      segments: [
        { kind: "project", value: "NSD" },
        { kind: "type", value: "MAR" },
        { kind: "participant", value: "01" },
        { kind: "sequence", value: "0001" },
      ],
    });
  });

  it("keeps the segments of the pattern an item was numbered under after the pattern changes", async () => {
    const t = await tower("NSC");
    const before = await t.numbered(t.c1.member);
    expect(before.number).toBe("NSC-MAR-01-0001");
    await t.pattern([{ kind: "project" }, { kind: "trade" }, { kind: "location", level: 2 }, { kind: "text", text: "QA" }], [0, 1, 2], 5, "/");
    const after = await t.numbered(t.c1.member);
    expect(after.number).toBe("NSC/EL/B1/QA/00001");

    expect((await segmentsOf(t.c1.member, before.id))?.segments.map((s) => s.kind)).toEqual(["project", "type", "participant", "sequence"]);
    expect(await segmentsOf(t.c1.member, after.id)).toEqual({
      separator: "/",
      segments: [
        { kind: "project", value: "NSC" },
        { kind: "trade", value: "EL" },
        { kind: "location", level: 2, value: "B1" },
        { kind: "text", value: "QA" },
        { kind: "sequence", value: "00001" },
      ],
    });
  });

  it("names the Participant Code a number was built with", async () => {
    const t = await tower("NSP");
    expect(await outcome(t.c1.ap, sql`select app.set_participant_code(${t.p1}::uuid, 'TMC') as outcome`)).toBe("set");
    const { id, number } = await t.numbered(t.c1.member);
    expect(number).toBe("NSP-MAR-TMC-0001");
    expect((await segmentsOf(t.c1.member, id))?.segments[2]).toEqual({ kind: "participant", value: "TMC" });
  });

  it("gives nothing for a Draft, which has no number", async () => {
    const t = await tower("NSN");
    const draft = await t.drafted(t.c1.member);
    expect(await segmentsOf(t.c1.member, draft)).toBeNull();
  });

  it("gives nothing for a number the item's pattern doesn't rebuild, such as one brought in from elsewhere", async () => {
    const t = await tower("NSI");
    const { id } = await t.numbered(t.c1.member);
    await migrator.query("update work_item set document_number = 'OLD-REG-17' where id = $1", [id]);
    expect(await segmentsOf(t.c1.member, id)).toBeNull();
  });

  it("gives nothing once a code the number printed has changed: the rebuild must match exactly", async () => {
    const t = await tower("NSR");
    const { id } = await t.numbered(t.c1.member);
    await migrator.query("update project set code = 'NSX' where id = $1", [t.projectId]);
    expect(await segmentsOf(t.c1.member, id)).toBeNull();
  });
});

describe("visibility.md, Document Numbers", () => {
  it("RP-1065-1: whoever sees the item reads the same segments, only what its number prints; anyone else reads none", async () => {
    const t = await tower("NSV");
    const { id, number } = await t.numbered(t.c1.member);
    // Still in C1's internal review: K1 and C2 don't see it, so they read nothing of it.
    for (const who of [t.k1.member, t.k1.ap, t.c2.member, t.c2.ap]) expect(await segmentsOf(who, id), who).toBeNull();
    await t.takes(t.c1.member, id, "submit");

    const own = await segmentsOf(t.c1.member, id);
    expect(own).not.toBeNull();
    expect(await segmentsOf(t.k1.member, id)).toEqual(own);
    // Each value is a part of the number, in order: nothing it doesn't print, no counter key or value.
    expect(own!.segments.map((s) => s.value).join(own!.separator)).toBe(number);
    expect(own!.segments.every((s) => Object.keys(s).every((key) => ["kind", "value", "level"].includes(key)))).toBe(true);
    expect(Object.keys(own!).sort()).toEqual(["segments", "separator"]);
    // C2, a Contractor that never had the item, still reads nothing.
    expect(await segmentsOf(t.c2.member, id)).toBeNull();
  });
});
