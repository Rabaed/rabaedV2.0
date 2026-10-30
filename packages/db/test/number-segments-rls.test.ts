// Seam 2 for a Document Number's segments (RP-1065, spec RP-1054 C4; GLOSSARY "Document
// Number", "Numbering Pattern", "Version"; visibility.md, Document Numbers, scenario
// RP-1065-1). `app.work_item_number_segments` names what each part of an item's number is,
// from the Numbering Pattern Version it was numbered under, for whoever sees the item; it
// carries only what the number already prints: no counter, no other Company's volume.
import { readFileSync } from "node:fs";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { bilingual, buildSeamTwoTower, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();

let migrator: pg.Client;
let app: Db;

type Segments = { separator: string; segments: { kind: string; value: string; level?: number }[] } | null;

/**
 * The seam 2 Tower (RP-980): C1, the Contractor whose Authorized Person created the Project (its
 * Participant is 01), with K1, a Consultant, and C2, another Contractor, here covering every
 * Location; Trade EL. Built here only, as the Tower has neither: Building B1 inside Building A, so a
 * number has a second Location level, and a Scope of the Trade for the MARs.
 */
async function tower(code: string) {
  const t = await buildSeamTwoTower(app, migrator, { projectCode: code, c2OtherLocation: false, checklistTemplate: false });
  const { projectId, tradeId, c1, call } = t;
  const [b1] = await call<{ value_id: string }>(
    c1.ap,
    sql`select value_id from app.add_dimension_value(${projectId}::uuid, 'location', ${t.buildingA}::uuid, 'B1', ${JSON.stringify(bilingual("B1"))}::jsonb)`,
  );
  const building = b1!.value_id;
  const [scope] = await call<{ scope_id: string }>(
    c1.ap,
    sql`select scope_id from app.add_scope(${projectId}::uuid, ${tradeId}::uuid, null, '{"en": "S", "ar": "ن"}'::jsonb)`,
  );

  /** What `as` reads of the item's number segments. */
  async function segmentsOf(as: string, item: string): Promise<Segments> {
    const [row] = await call<{ segments: Segments }>(as, sql`select app.work_item_number_segments(${item}::uuid) as segments`);
    return row!.segments;
  }

  /** `as` raises a MAR in B1, a Draft; returns its id. */
  async function drafted(as: string): Promise<string> {
    const [draft] = await call<{ outcome: string; work_item_id: string }>(
      as,
      sql`select outcome, work_item_id from app.create_work_item(
        ${projectId}::uuid, 'MAR', 'Cable trays', app.latest_form_version('MAR'), '{"description": "Galvanised"}'::jsonb,
        ${tradeId}::uuid, ${building}::uuid, now(), ${[scope!.scope_id]}::uuid[])`,
    );
    expect(draft!.outcome).toBe("created");
    return draft!.work_item_id;
  }

  /** `as` raises a MAR in B1 and sends it for review; returns its id and Document Number. */
  async function numbered(as: string): Promise<{ id: string; number: string }> {
    const id = await drafted(as);
    expect(await t.take(as, id, "send_for_review")).toBe("applied");
    const number = (await migrator.query("select document_number from work_item where id = $1", [id])).rows[0].document_number as string;
    return { id, number };
  }

  /** C1's Project Manager picks the item up in C1's internal review and Submits it to K1. */
  async function submitted(item: string) {
    expect(await t.pickUp(c1.members.project_manager, item)).toBe("picked_up");
    expect(await t.take(c1.members.project_manager, item, "submit")).toBe("applied");
  }

  /** Adds a Numbering Pattern row as the migrator, set by C1's Authorized Person. */
  async function pattern(segments: object[], seqScope: number[], seqDigits = 4, separator = "-") {
    await migrator.query(
      `insert into numbering_pattern (project_id, segments, separator, seq_digits, seq_scope, shared_counter_accepted_at, set_by_member_id)
       values ($1, $2, $3, $4, $5, now(), $6)`,
      [projectId, JSON.stringify(segments), separator, seqDigits, JSON.stringify(seqScope), c1.ap],
    );
  }

  return { ...t, segmentsOf, drafted, numbered, submitted, pattern };
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
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
    const { id, number } = await t.numbered(t.c1.members.engineer);
    expect(number).toBe("NSD-MAR-01-0001");
    expect(await t.segmentsOf(t.c1.members.engineer, id)).toEqual({
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
    const before = await t.numbered(t.c1.members.engineer);
    expect(before.number).toBe("NSC-MAR-01-0001");
    await t.pattern([{ kind: "project" }, { kind: "trade" }, { kind: "location", level: 2 }, { kind: "text", text: "QA" }], [0, 1, 2], 5, "/");
    const after = await t.numbered(t.c1.members.engineer);
    expect(after.number).toBe("NSC/EL/B1/QA/00001");

    expect((await t.segmentsOf(t.c1.members.engineer, before.id))?.segments.map((s) => s.kind)).toEqual(["project", "type", "participant", "sequence"]);
    expect(await t.segmentsOf(t.c1.members.engineer, after.id)).toEqual({
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
    expect(await t.outcome(t.c1.ap, sql`select app.set_participant_code(${t.c1.participantId}::uuid, 'TMC') as outcome`)).toBe("set");
    const { id, number } = await t.numbered(t.c1.members.engineer);
    expect(number).toBe("NSP-MAR-TMC-0001");
    expect((await t.segmentsOf(t.c1.members.engineer, id))?.segments[2]).toEqual({ kind: "participant", value: "TMC" });
  });

  it("gives nothing for a Draft, which has no number", async () => {
    const t = await tower("NSN");
    const draft = await t.drafted(t.c1.members.engineer);
    expect(await t.segmentsOf(t.c1.members.engineer, draft)).toBeNull();
  });

  it("gives nothing for a number the item's pattern doesn't rebuild, such as one brought in from elsewhere", async () => {
    const t = await tower("NSI");
    const { id } = await t.numbered(t.c1.members.engineer);
    await migrator.query("update work_item set document_number = 'OLD-REG-17' where id = $1", [id]);
    expect(await t.segmentsOf(t.c1.members.engineer, id)).toBeNull();
  });

  it("gives nothing once a code the number printed has changed: the rebuild must match exactly", async () => {
    const t = await tower("NSR");
    const { id } = await t.numbered(t.c1.members.engineer);
    await migrator.query("update project set code = 'NSX' where id = $1", [t.projectId]);
    expect(await t.segmentsOf(t.c1.members.engineer, id)).toBeNull();
  });
});

describe("visibility.md, Document Numbers", () => {
  it("RP-1065-1: whoever sees the item reads the same segments, only what its number prints; anyone else reads none", async () => {
    const t = await tower("NSV");
    const { id, number } = await t.numbered(t.c1.members.engineer);
    // C2 reads the segments of an item it does see, its own once numbered (the positive control):
    // the refusals below are about C1's item, not a C2 Member who reaches nothing at all. C2's
    // internal review needs a Project Manager, which the Tower's C2 lacks: its Engineer is one here.
    expect(
      await t.outcome(
        t.c2.ap,
        sql`select app.set_project_member_positions(${t.c2.participantId}::uuid, ${t.c2.members.engineer}::uuid, ${["engineer", "project_manager"]}::text[]) as outcome`,
      ),
    ).toBe("set");
    const theirs = await t.numbered(t.c2.members.engineer);
    const theirSegments = await t.segmentsOf(t.c2.members.engineer, theirs.id);
    expect(theirSegments?.segments.map((s) => s.value).join(theirSegments.separator)).toBe(theirs.number);

    // Still in C1's internal review: K1 and C2 don't see it, so they read nothing of it.
    for (const who of [t.k1.members.engineer, t.k1.ap, t.c2.members.engineer, t.c2.ap]) expect(await t.segmentsOf(who, id), who).toBeNull();
    await t.submitted(id);

    const own = await t.segmentsOf(t.c1.members.engineer, id);
    expect(own).not.toBeNull();
    expect(await t.segmentsOf(t.k1.members.engineer, id)).toEqual(own);
    // Each value is a part of the number, in order: nothing it doesn't print, no counter key or value.
    expect(own!.segments.map((s) => s.value).join(own!.separator)).toBe(number);
    expect(own!.segments.every((s) => Object.keys(s).every((key) => ["kind", "value", "level"].includes(key)))).toBe(true);
    expect(Object.keys(own!).sort()).toEqual(["segments", "separator"]);
    // C2, a Contractor that never had the item, still reads nothing.
    expect(await t.segmentsOf(t.c2.members.engineer, id)).toBeNull();
  });
});
