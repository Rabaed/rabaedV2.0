// Seam 2 for Links (RP-291, spec RP-289; visibility.md E1, the Links row and
// scenario 12): a Link is read under its _from_ item's own row-level security,
// keyed by Project, so Project B's Links never return with a Member of Project A
// set, and a Link whose _from_ item the reader can't see never returns. The
// target's id isn't readable from the table at all: app.work_item_links gives
// each target's Document Number and Subject, and its id only to a reader who
// sees it. The app role can't write the table.
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
  projectId: string;
  from: string; // A MAR in Building A.
  target: string; // A MAR in Building B, numbered.
  targetNumber: string;
  link: string; // from -> target.
  backLink: string; // target -> from.
};
let a: Side; // Project A, its Contractor's.
let b: Side; // Project B, another Company's.

const call = <T extends object>(as: string, query: ReturnType<typeof sql<T>>) =>
  withMember(app, as, (trx) => query.execute(trx).then((r) => r.rows));

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

/** A Link row written as the owner (rabaed_app can't), as the app.* functions would. */
const insertLink = (projectId: string, from: string, to: string, by: string) =>
  one("insert into work_item_link (project_id, from_id, to_id, kind, created_by_member_id) values ($1, $2, $3, 'related', $4) returning id", [
    projectId,
    from,
    to,
    by,
  ]);

/** A Company whose Authorized Person creates a Project with two MARs, the first linking the second, and back. */
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
  const mar = async (title: string, location: string) => {
    const [item] = await call<{ outcome: string; work_item_id: string }>(
      ap,
      sql`select outcome, work_item_id from app.create_work_item(
        ${projectId}::uuid, 'MAR', ${title}, app.latest_form_version('MAR'), '{}'::jsonb,
        ${electrical}::uuid, ${location}::uuid, now())`,
    );
    expect(item!.outcome).toBe("created");
    return item!.work_item_id;
  };
  const from = await mar("Cable trays", buildingA);
  const target = await mar("Approved busbars", buildingB);
  const targetNumber = `${code}-MAR-01-0001`;
  await migrator.query("update work_item set document_number = $1 where id = $2", [targetNumber, target]);
  return {
    ap,
    narrow,
    projectId,
    from,
    target,
    targetNumber,
    link: await insertLink(projectId, from, target, ap),
    backLink: await insertLink(projectId, target, from, ap),
  };
}

const linkIds = (as: string) =>
  call<{ id: string }>(as, sql`select id from work_item_link`).then((rows) => rows.map((r) => r.id).sort());

type ReadLink = { id: string; kind: string; field_key: string | null; document_number: string; subject: string; work_item_id: string | null };
const linksOf = (as: string, item: string) =>
  call<ReadLink>(as, sql`select id, kind, field_key, document_number, subject, work_item_id from app.work_item_links(${item}::uuid)`);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  a = await side(engineer, "A", "AAA");
  b = await side(engineer, "B", "BBB");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("a Link", () => {
  it("returns to the Members who see its from item", async () => {
    expect(await linkIds(a.ap)).toEqual([a.link, a.backLink].sort());
    expect(await linkIds(b.ap)).toEqual([b.link, b.backLink].sort());
  });

  it("of Project B never returns with a Member of Project A set, even by its id or through the reading function", async () => {
    expect(await call(a.ap, sql<object>`select id from work_item_link where id = ${b.link}::uuid or from_id = ${b.from}::uuid`)).toEqual([]);
    expect(await linksOf(a.ap, b.from)).toEqual([]);
  });

  it("whose from item the reader can't see never returns", async () => {
    // The narrow Member sees the item in Building A, not the one in Building B.
    expect(await linkIds(a.narrow)).toEqual([a.link]);
    expect(await linksOf(a.narrow, a.target)).toEqual([]);
  });

  it("never gives the app role its target's id from the table", async () => {
    for (const column of ["to_id", "created_by_member_id"]) {
      await expect(call(a.ap, sql<object>`select ${sql.ref(column)} from work_item_link`), column).rejects.toThrow(/permission denied/);
    }
  });

  it("reads as the target's Document Number and Subject, with its id only for a reader who sees it (E1, scenario 12)", async () => {
    const shown = { id: a.link, kind: "related", field_key: null, document_number: a.targetNumber, subject: "Approved busbars" };
    expect(await linksOf(a.ap, a.from)).toEqual([{ ...shown, work_item_id: a.target }]);
    expect(await linksOf(a.narrow, a.from)).toEqual([{ ...shown, work_item_id: null }]);
  });

  it("can't be written by the app role directly, only through the app functions", async () => {
    await expect(call(a.ap, sql<object>`insert into work_item_link (project_id, from_id, to_id, kind, created_by_member_id)
      values (${a.projectId}::uuid, ${a.target}::uuid, ${a.from}::uuid, 'related', ${a.ap}::uuid)`)).rejects.toThrow(/permission denied/);
    await expect(call(a.ap, sql<object>`update work_item_link set kind = 'relies_on' where id = ${a.link}::uuid`)).rejects.toThrow(/permission denied/);
    await expect(call(a.ap, sql<object>`delete from work_item_link where id = ${a.link}::uuid`)).rejects.toThrow(/permission denied/);
  });
});

describe("the work_item_link table", () => {
  it("refuses a Link to the item itself, across Projects, a field key on a free Link, and the same target twice", async () => {
    const insert = (values: unknown[]) =>
      migrator.query(
        "insert into work_item_link (project_id, from_id, to_id, kind, field_key, created_by_member_id) values ($1, $2, $3, $4, $5, $6)",
        values,
      );
    await expect(insert([a.projectId, a.from, a.from, "related", null, a.ap])).rejects.toThrow(/check/);
    await expect(insert([a.projectId, a.from, b.target, "related", null, a.ap])).rejects.toThrow(/foreign key/);
    await expect(insert([a.projectId, a.from, a.target, "related", "datasheet", a.ap])).rejects.toThrow(/check/);
    await expect(insert([a.projectId, a.from, a.target, "relies_on", null, a.ap])).rejects.toThrow(/check/);
    await expect(insert([a.projectId, a.from, a.target, "related", null, a.ap])).rejects.toThrow(/duplicate key/);
  });
});
