// Seam 2 for the UAT tool's `uat:age` (RP-922, tests 3, 4, 5 and 8): an item moved back N weeks reads
// Step Age N to its holder, and every reader of Step Age follows it (app.step_as_seen); the Creation
// Date rules still hold; the audit trail is left exactly as it was. The tool runs as the migrator
// (packages/db/dev-tools), the reads as Members on the app role.
import { stepAgeWeeks } from "@rabaed/domain";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ageChanges, ageItems, findAgeCandidates } from "../dev-tools/index.ts";
import { createDb, type Db } from "../src/index.ts";
import { buildSeamTwoTower, testDatabaseUrls, wirAtConsultant, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
let migrator: pg.Client;
let app: Db;
let tool: Db;
let tower: SeamTwoTower;
let serial = 0;

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  tool = createDb(urls.migrator, { max: 1 });
  tower = await buildSeamTwoTower(app, migrator, { projectCode: "RUA" });
});
afterAll(async () => {
  await migrator?.end();
  await app?.destroy();
  await tool?.destroy();
});

/** A WIR C1 Submitted, held by K1's Engineer; its id and Document Number. */
async function heldByK1(): Promise<{ id: string; number: string }> {
  const id = await wirAtConsultant(tower, { type: "WIR", title: `Aged pour ${++serial} ${Date.now()}` });
  const { rows } = await migrator.query<{ document_number: string }>("select document_number from work_item where id = $1", [id]);
  return { id, number: rows[0]!.document_number };
}

/** `uat:age --item <texts> --weeks <weeks>`, as the CLI runs it: candidates, the changes, then the write. */
async function age(texts: string[], weeks: number, { dryRun = false } = {}) {
  const changes = ageChanges({ items: texts, weeks }, await findAgeCandidates(tool, texts), new Date());
  if ("errors" in changes) throw new Error(changes.errors.join("; "));
  return ageItems(tool, changes.items, { dryRun });
}

/** When item `id`'s Step began, as Member `as` reads it (their Company's Step Age). */
async function enteredAsSeen(as: string, id: string): Promise<Date> {
  const [row] = await tower.call<{ entered_at: Date }>(as, sql`select entered_at from app.step_as_seen(${id}::uuid)`);
  return row!.entered_at;
}

describe("Step Age after uat:age", () => {
  it("its holder reads Step Age 4 after --weeks 4; another Company counts from when it reached K1, moved alike", async () => {
    const { id, number } = await heldByK1();
    const holderBefore = await enteredAsSeen(tower.k1.members.engineer, id);
    const raiserBefore = await enteredAsSeen(tower.c1.members.engineer, id);
    expect(stepAgeWeeks(holderBefore, new Date())).toBe(1);

    await age([number], 4);

    const holderAfter = await enteredAsSeen(tower.k1.members.engineer, id);
    expect(stepAgeWeeks(holderAfter, new Date())).toBe(4);
    const shift = holderBefore.getTime() - holderAfter.getTime();
    expect(shift).toBeGreaterThan(3 * 7 * 24 * 3_600_000);
    expect((await enteredAsSeen(tower.c1.members.engineer, id)).getTime()).toBe(raiserBefore.getTime() - shift);
  });
});
