// Seam 2: the one SQL definition of the pattern in effect and the Rabaed Default
// (app.numbering_pattern_in_effect, RP-380) against @rabaed/domain's, and the
// counter key app.numbering_counter_for derives from it against the domain's for
// the shared cases (packages/domain/src/numbering-cases.json; CODING_STANDARDS,
// Tests: a rule enforced in SQL and in TypeScript is tested against the same cases).
import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  documentNumbering,
  rabaedDefaultNumberingPattern,
  type NumberingAttributes,
  type NumberingPattern,
} from "@rabaed/domain";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

type Case = { name: string; pattern: NumberingPattern; item: NumberingAttributes; seq: number };
const cases = JSON.parse(readFileSync(new URL("../../domain/src/numbering-cases.json", import.meta.url), "utf8")) as Case[];

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;

let migrator: pg.Client;
let app: Db;
let projectId = "";
let participantId = "";
let adminId = "";
const projectCode = "PIE";

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  const company = await one(
    "insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id",
    [JSON.stringify({ en: "C1", ar: "C1" }), digits(10), `3${digits(13)}3`, engineer],
  );
  adminId = await one(
    "insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', true) returning id",
    [company, email("ap"), JSON.stringify({ en: "ap", ar: "ap" })],
  );
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [adminId, company]);
  const created = await withMember(app, adminId, (trx) =>
    sql<{ project_id: string }>`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, ${projectCode}, 'contractor')`
      .execute(trx)
      .then((r) => r.rows),
  );
  projectId = created[0]!.project_id;
  participantId = await one("select id from participant where project_id = $1", [projectId]);
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

const inEffect = async (project: string, typeId: string | null) =>
  (
    await migrator.query<{ segments: unknown; separator: string; seq_digits: number; seq_scope: unknown }>(
      "select * from app.numbering_pattern_in_effect($1::uuid, $2::uuid, now())",
      [project, typeId],
    )
  ).rows;

const counterKey = async () =>
  (
    await migrator.query<{ outcome: string; counter_key: string; prefix: string; seq_digits: number; separator: string }>(
      "select * from app.numbering_counter_for($1::uuid, 'MAR', $2::uuid, null, null, now())",
      [projectId, participantId],
    )
  ).rows[0]!;

describe("the Rabaed Default", () => {
  it("is the same in SQL and in the domain", async () => {
    const rows = await inEffect(randomUUID(), null);
    expect(rows).toHaveLength(1);
    const d = rabaedDefaultNumberingPattern;
    expect(rows[0]).toEqual({ segments: d.segments, separator: d.separator, seq_digits: d.seqDigits, seq_scope: d.countedBy });
  });

  it("is in the shared cases", () => {
    expect(cases.map((c) => c.pattern)).toContainEqual(rabaedDefaultNumberingPattern);
  });

  it("keys the same counter and prints the same number as the domain's for a Project without a pattern", async () => {
    const row = await counterKey();
    const expected = documentNumbering(rabaedDefaultNumberingPattern, {
      projectCode,
      typeCode: "MAR",
      tradeCode: null,
      participant: { code: null, ordinal: 1 },
      locationPath: [],
    });
    expect(row.outcome).toBe("found");
    expect(row.counter_key).toBe(expected.counterKey);
    expect(row.prefix + row.separator + String(1).padStart(row.seq_digits, "0")).toBe(expected.number(1));
  });
});

// Each shared case saved as a Project's pattern, with the item's values as the
// Project's own: its Participant's code and order on the Project, its Trade, its
// Location (the deepest of the case's path). numbering_counter_for keys the
// counter from the saved pattern, as app.take_transition does, and must key and
// print what the domain does. A case whose counted segment has no value (no Trade,
// no Location) is refused instead: a counter is keyed only with every value it
// counts by, while an issued number prints nothing there (numbering-builder.test.ts).
describe("a Project's saved pattern, the shared cases", () => {
  let tower = "";
  let towerParticipantId = "";
  const trades = new Map<string, string>();
  const locations = new Map<string, string>();

  beforeAll(async () => {
    const created = await withMember(app, adminId, (trx) =>
      sql<{ project_id: string }>`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, 'TWR', 'contractor')`
        .execute(trx)
        .then((r) => r.rows),
    );
    tower = created[0]!.project_id;
    towerParticipantId = await one("select id from participant where project_id = $1", [tower]);
    const value = (kind: string, code: string, parent: string | null) =>
      withMember(app, adminId, (trx) =>
        sql<{ value_id: string }>`select value_id from app.add_dimension_value(${tower}::uuid, ${kind}, ${parent}::uuid, ${code}, '{"en": "V", "ar": "ق"}'::jsonb)`
          .execute(trx)
          .then((r) => r.rows[0]!.value_id),
      );
    for (const code of new Set(cases.flatMap((c) => (c.item.tradeCode === null ? [] : [c.item.tradeCode])))) {
      trades.set(code, await value("trade", code, null));
    }
    // The cases' Location paths all run along one branch, Z1 > B1 > F2.
    const deepest = cases.reduce<string[]>((path, c) => (c.item.locationPath.length > path.length ? c.item.locationPath : path), []);
    let parent: string | null = null;
    for (const code of deepest) {
      parent = await value("location", code, parent);
      locations.set(code, parent);
    }
  });

  it.each(cases)("$name", async ({ pattern, item, seq }) => {
    await migrator.query(
      `insert into numbering_pattern (project_id, segments, separator, seq_digits, seq_scope, shared_counter_accepted_at, set_by_member_id)
       values ($1, $2, $3, $4, $5, now(), $6)`,
      [tower, JSON.stringify(pattern.segments), pattern.separator, pattern.seqDigits, JSON.stringify(pattern.countedBy), adminId],
    );
    expect(await inEffect(tower, null)).toEqual([
      { segments: pattern.segments, separator: pattern.separator, seq_digits: pattern.seqDigits, seq_scope: pattern.countedBy },
    ]);
    await migrator.query("update participant set code = $1, ordinal = $2 where id = $3", [
      item.participant.code,
      item.participant.ordinal,
      towerParticipantId,
    ]);
    const tradeId = item.tradeCode === null ? null : (trades.get(item.tradeCode) ?? null);
    const lowest = item.locationPath.at(-1);
    const locationId = lowest === undefined ? null : (locations.get(lowest) ?? null);
    const { rows } = await migrator.query<{ outcome: string; counter_key: string | null; number: string | null }>(
      `select c.outcome, c.counter_key, app.sequenced_document_number(c.prefix, c.separator, c.seq_digits, $6) as number
       from app.numbering_counter_for($1::uuid, $2, $3::uuid, $4::uuid, $5::uuid, now()) c`,
      [tower, item.typeCode, towerParticipantId, tradeId, locationId, seq],
    );
    const counted = pattern.countedBy.map((i) => pattern.segments[i]?.kind);
    const missing = counted.includes("trade") && tradeId === null ? "trade" : counted.includes("location") && locationId === null ? "location" : null;
    if (missing) {
      expect(rows).toEqual([{ outcome: `${missing}_required`, counter_key: null, number: null }]);
      return;
    }
    const expected = documentNumbering(pattern, item);
    expect(rows).toEqual([{ outcome: "found", counter_key: expected.counterKey, number: expected.number(seq) }]);
  });
});
