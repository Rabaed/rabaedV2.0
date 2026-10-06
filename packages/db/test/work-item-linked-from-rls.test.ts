// Seam 2 for "Linked from" (RP-292, spec RP-289; visibility.md E3, the Linked
// from row and scenarios 77-78): app.work_item_linked_from lists, for an item
// the caller sees, every Submitted item that links to it. Each comes back as its
// Document Number and Subject, with its id only for a caller who sees it, and
// nothing else (no Stage, Code or Company). A Draft or an item in its raiser's
// internal review never comes back, and an item the caller can't see has no
// Linked from at all. The app role can't get there through the table: it can't
// read a Link's target.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;

let migrator: pg.Client;
let app: Db;

type Side = {
  ap: string; // The Authorized Person, who created the Project and covers all of it.
  narrow: string; // A Member of the same Company covering Building A only.
  target: string; // A Submitted MAR in Building A, which everyone below links to.
  hiddenLinker: string; // Submitted, in Building B: hidden from the narrow Member.
  visibleLinker: string; // Submitted, in Building A, linking twice (freely and through a link question).
  draftLinker: string; // Still in Draft.
  internalLinker: string; // In its raiser's internal review.
  code: string;
};
let a: Side; // Project A.
let b: Side; // Project B, another Company's.

const call = <T extends object>(as: string, query: ReturnType<typeof sql<T>>) =>
  withMember(app, as, (trx) => query.execute(trx).then((r) => r.rows));

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

/**
 * Puts an item where its workflow would: the holder's Step and the Step its
 * holder's Participant received it at, as the transition functions set them
 * (this seam has no Consultant to Submit to).
 */
async function moveTo(item: string, state: "internal" | "submitted") {
  const transition = state === "internal" ? "send_for_review" : "submit";
  const { rowCount } = await migrator.query(
    `update work_item w set current_step_id = t.to_step_id,
       participant_entered_step_id = case when $2 = 'submitted' then t.to_step_id else w.participant_entered_step_id end,
       submitted_at = case when $2 = 'submitted' then coalesce(w.submitted_at, now()) else w.submitted_at end
     from workflow_transition t
     where w.id = $1 and t.workflow_version_id = w.workflow_version_id and t.key = $3`,
    [item, state, transition],
  );
  expect(rowCount).toBe(1);
}

/** A Company whose Authorized Person creates a Project with a MAR and four MARs linking to it. */
async function side(engineer: string, name: string, code: string): Promise<Side> {
  const companyId = await one(
    "insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id",
    [JSON.stringify({ en: name, ar: name }), digits(10), `3${digits(13)}3`, engineer],
  );
  const person = (who: string, creator: boolean) =>
    one(
      "insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', $4) returning id",
      [companyId, email(who), JSON.stringify({ en: who, ar: who }), creator],
    );
  const ap = await person("ap", true);
  const narrow = await person("narrow", false);
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [ap, companyId]);
  const [created] = await call<{ project_id: string }>(
    ap,
    sql`select project_id from app.create_project(${JSON.stringify({ en: name, ar: name })}::jsonb, ${code}, 'contractor')`,
  );
  const projectId = created!.project_id;
  const value = async (kind: string, valueCode: string) =>
    (
      await call<{ value_id: string }>(
        ap,
        sql`select value_id from app.add_dimension_value(${projectId}::uuid, ${kind}, null, ${valueCode}, ${JSON.stringify({ en: valueCode, ar: valueCode })}::jsonb)`,
      )
    )[0]!.value_id;
  const electrical = await value("trade", "EL");
  const buildingA = await value("location", "BA");
  const buildingB = await value("location", "BB");
  const participantId: string = (await migrator.query("select participant_id from project_member where project_id = $1", [projectId]))
    .rows[0].participant_id;
  await call(ap, sql<object>`select app.add_project_member(${participantId}::uuid, ${narrow}::uuid, now())`);
  const visibility = async (member: string, kind: string, values: string[] | "all") =>
    expect(
      await call<{ outcome: string }>(
        ap,
        sql`select app.set_member_visibility(${participantId}::uuid, ${member}::uuid, ${kind}, ${values === "all"},
          ${values === "all" ? [] : values}::uuid[], now()) as outcome`,
      ),
    ).toEqual([{ outcome: "set" }]);
  for (const kind of ["trade", "location"]) {
    await call(ap, sql<object>`select app.set_participant_visibility(${participantId}::uuid, ${kind}, true, '{}'::uuid[], now())`);
    await visibility(ap, kind, "all");
  }
  await visibility(narrow, "trade", "all");
  await visibility(narrow, "location", [buildingA]);
  let numbered = 0;
  const mar = async (title: string, location: string) => {
    const [item] = await call<{ outcome: string; work_item_id: string }>(
      ap,
      sql`select outcome, work_item_id from app.create_work_item(
        ${projectId}::uuid, 'MAR', ${title}, app.latest_form_version('MAR'), '{}'::jsonb,
        ${electrical}::uuid, ${location}::uuid, now())`,
    );
    expect(item!.outcome).toBe("created");
    numbered += 1;
    await migrator.query("update work_item set document_number = $1 where id = $2", [`${code}-MAR-01-000${numbered}`, item!.work_item_id]);
    return item!.work_item_id;
  };
  // Links written as the owner (rabaed_app can't), as the app.* functions would.
  const link = (from: string, to: string, kind: "related" | "relies_on" = "related") =>
    migrator.query(
      "insert into work_item_link (project_id, from_id, to_id, kind, field_key, created_by_member_id) values ($1, $2, $3, $4, $5, $6)",
      [projectId, from, to, kind, kind === "relies_on" ? "related_submittals" : null, ap],
    );
  const target = await mar("Approved busbars", buildingA);
  const hiddenLinker = await mar("Busbar risers", buildingB);
  const visibleLinker = await mar("Cable trays", buildingA);
  const draftLinker = await mar("Draft trunking", buildingA);
  const internalLinker = await mar("Internal conduits", buildingA);
  for (const item of [target, hiddenLinker, visibleLinker]) await moveTo(item, "submitted");
  await moveTo(internalLinker, "internal");
  for (const from of [hiddenLinker, visibleLinker, draftLinker, internalLinker]) await link(from, target);
  await link(visibleLinker, target, "relies_on");
  await link(target, visibleLinker);
  return { ap, narrow, target, hiddenLinker, visibleLinker, draftLinker, internalLinker, code };
}

const linkedFrom = (as: string, item: string) => call<object>(as, sql`select * from app.work_item_linked_from(${item}::uuid)`);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  a = await side(engineer, "A", "LFA");
  b = await side(engineer, "B", "LFB");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("Linked from", () => {
  it("lists each Submitted item linking to a visible item once, with its id for a caller who sees it", async () => {
    expect(await linkedFrom(a.ap, a.target)).toEqual([
      { document_number: `${a.code}-MAR-01-0002`, subject: "Busbar risers", work_item_id: a.hiddenLinker },
      { document_number: `${a.code}-MAR-01-0003`, subject: "Cable trays", work_item_id: a.visibleLinker },
    ]);
  });

  it("gives a linking item the caller can't see as its Document Number and Subject only, never its id (E3, scenario 77)", async () => {
    expect(await linkedFrom(a.narrow, a.target)).toEqual([
      { document_number: `${a.code}-MAR-01-0002`, subject: "Busbar risers", work_item_id: null },
      { document_number: `${a.code}-MAR-01-0003`, subject: "Cable trays", work_item_id: a.visibleLinker },
    ]);
  });

  it("never lists a Draft or an item in internal review, whoever asks (scenario 78)", async () => {
    for (const who of [a.ap, a.narrow]) {
      const listed = JSON.stringify(await linkedFrom(who, a.target));
      for (const unsent of [a.draftLinker, a.internalLinker]) expect(listed).not.toContain(unsent);
      expect(listed).not.toMatch(/Draft trunking|Internal conduits/);
    }
  });

  it("is empty for an item the caller can't see, and for another Project's item", async () => {
    expect(await linkedFrom(a.narrow, a.hiddenLinker)).toEqual([]);
    expect(await linkedFrom(a.ap, b.target)).toEqual([]);
    expect(await linkedFrom(b.ap, a.target)).toEqual([]);
  });

  it("can't be read around through the table: the app role never gets a Link's target", async () => {
    await expect(call(a.narrow, sql<object>`select from_id from work_item_link where to_id = ${a.target}::uuid`)).rejects.toThrow(
      /permission denied/,
    );
  });
});
