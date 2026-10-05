// Seam 2: the database's Document Number builder (app.document_numbering, the key
// and prefix, and app.sequenced_document_number, the sequence) against the cases
// @rabaed/domain's documentNumbering runs too (packages/domain/src/numbering-cases.json;
// CODING_STANDARDS, Tests: a rule enforced in SQL and in TypeScript is tested
// against the same cases). Pure functions: called on the migrator connection.
import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseUrls } from "../test-support/index.ts";

type Case = {
  name: string;
  pattern: { segments: object[]; separator: string; seqDigits: number; countedBy: number[] };
  item: {
    projectCode: string;
    typeCode: string;
    tradeCode: string | null;
    participant: { code: string | null; ordinal: number };
    locationPath: string[];
  };
  seq: number;
  counterKey: string;
  number: string;
};

const cases = JSON.parse(readFileSync(new URL("../../domain/src/numbering-cases.json", import.meta.url), "utf8")) as Case[];

let migrator: pg.Client;
beforeAll(async () => {
  migrator = new pg.Client({ connectionString: testDatabaseUrls().migrator });
  await migrator.connect();
});
afterAll(async () => {
  await migrator?.end();
});

describe("app.document_numbering and app.sequenced_document_number, the shared cases", () => {
  it.each(cases)("$name", async ({ pattern, item, seq, counterKey, number }) => {
    // The attributes as app.issue_document_number hands them over.
    const attributes = {
      project_code: item.projectCode,
      type_code: item.typeCode,
      trade_code: item.tradeCode,
      participant_code: item.participant.code,
      participant_ordinal: item.participant.ordinal,
      location_path: item.locationPath,
    };
    const { rows } = await migrator.query<{ counter_key: string; number: string }>(
      `select n.counter_key, app.sequenced_document_number(n.prefix, $2, $5, $6) as number
       from app.document_numbering($1::jsonb, $2, $3::jsonb, $4::jsonb) n`,
      [JSON.stringify(pattern.segments), pattern.separator, JSON.stringify(pattern.countedBy), JSON.stringify(attributes), pattern.seqDigits, seq],
    );
    expect(rows).toEqual([{ counter_key: counterKey, number }]);
  });
});
