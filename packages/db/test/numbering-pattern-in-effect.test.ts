// Seam 2: the one SQL definition of the pattern in effect and the Rabaed Default
// (app.numbering_pattern_in_effect, RP-380) against @rabaed/domain's, and the
// counter key app.numbering_counter_for derives from it against the domain's for
// the shared cases (packages/domain/src/numbering-cases.json; CODING_STANDARDS,
// Tests: a rule enforced in SQL and in TypeScript is tested against the same cases).
import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { documentNumbering, rabaedDefaultNumberingPattern, type NumberingPattern } from "@rabaed/domain";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

type Case = { name: string; pattern: NumberingPattern };
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

describe("a Project's saved pattern", () => {
  it("is the one numbering_counter_for keys from", async () => {
    const pattern: NumberingPattern = {
      segments: [{ kind: "text", text: "X" }, { kind: "project" }, { kind: "participant" }],
      separator: "/",
      seqDigits: 3,
      countedBy: [1, 2],
    };
    await migrator.query(
      `insert into numbering_pattern (project_id, segments, separator, seq_digits, seq_scope, shared_counter_accepted_at, set_by_member_id)
       values ($1, $2, $3, $4, $5, now(), $6)`,
      [projectId, JSON.stringify(pattern.segments), pattern.separator, pattern.seqDigits, JSON.stringify(pattern.countedBy), adminId],
    );
    const [saved] = await inEffect(projectId, null);
    expect(saved).toEqual({ segments: pattern.segments, separator: "/", seq_digits: 3, seq_scope: [1, 2] });
    const row = await counterKey();
    const expected = documentNumbering(pattern, {
      projectCode,
      typeCode: "MAR",
      tradeCode: null,
      participant: { code: null, ordinal: 1 },
      locationPath: [],
    });
    expect(row.counter_key).toBe(expected.counterKey);
    expect(row.prefix + row.separator + "001").toBe(expected.number(1));
  });
});
