// Seam 2 for the link question, `work_item_ref` (RP-293, spec RP-289; ADR 0012 as
// amended 2026-10-05; visibility.md E1 and scenario 81). The answers function
// gives a chosen item the reader sees as its id, and one they can't see as its
// Document Number and Subject, never its id. Saving the answers keeps the
// field's `relies_on` Links equal to them, in the same transaction, and refuses
// any item Link search couldn't have offered, whatever the app role sends.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;
const TYPE = "LINKDB";

let migrator: pg.Client;
let app: Db;

type Side = {
  ap: string; // The Authorized Person, who covers all of the Project.
  narrow: string; // A Member of the same Company covering Building A only.
  projectId: string;
  electrical: string;
  buildingA: string;
  from: string; // The item with the link question, in Building A.
  seen: string; // A Submitted MAR in Building A: everyone here sees it.
  hidden: string; // A Submitted MAR in Building B: the narrow Member can't see it.
  hiddenNumber: string;
  draft: string; // A MAR still in Draft, in Building A.
};
let a: Side;
let b: Side;

const call = <T extends object>(as: string, query: ReturnType<typeof sql<T>>) =>
  withMember(app, as, (trx) => query.execute(trx).then((r) => r.rows));

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

/** A test-only Rabaed Default Type (the MAR's Workflow) whose Form has one link question, `related`. */
async function addLinkType() {
  const schema = {
    sections: [
      {
        key: "main",
        title: { en: "Main", ar: "الرئيسي" },
        fields: [{ key: "related", type: "work_item_ref", label: { en: "Related submittals", ar: "التقديمات ذات الصلة" } }],
      },
    ],
  };
  await migrator.query(
    `do $$
      declare v_definition uuid;
      begin
        if exists (select 1 from work_item_type where owner_kind = 'rabaed' and code = '${TYPE}') then return; end if;
        insert into form_definition (owner_kind, name) values ('rabaed', '{"en": "Links", "ar": "الروابط"}')
        returning id into v_definition;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_definition, 1, 'published', now(), '${JSON.stringify(schema)}'::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        select 'rabaed', module_key, '${TYPE}', '{"en": "Links", "ar": "الروابط"}', workflow_definition_id, outcome_kind, v_definition
        from work_item_type where owner_kind = 'rabaed' and code = 'MAR';
      end
    $$`,
  );
}

/** As the owner: the item has left its raiser (Submitted), as a Submit would leave it, and is numbered. */
async function submit(item: string, number: string) {
  await migrator.query(
    `update work_item w set document_number = $2, submitted_at = coalesce(submitted_at, now()), participant_entered_step_id = (
       select s.id from workflow_step s where s.workflow_version_id = w.workflow_version_id and not app.is_draft_step(s.id)
       order by s.id limit 1)
     where w.id = $1`,
    [item, number],
  );
}

/** As the owner: the item is back with its raiser, in Draft, as a Send Back to Draft would leave it (still Submitted once). */
async function unsubmit(item: string) {
  await migrator.query(
    `update work_item w set participant_entered_step_id = (
       select s.id from workflow_step s where s.workflow_version_id = w.workflow_version_id and app.is_draft_step(s.id)
       order by s.id limit 1)
     where w.id = $1`,
    [item],
  );
}

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
  const visibility = (member: string, kind: string, values: string[] | "all") =>
    call(
      ap,
      sql<object>`select app.set_member_visibility(${participantId}::uuid, ${member}::uuid, ${kind}, ${values === "all"},
        ${values === "all" ? [] : values}::uuid[], now())`,
    );
  for (const kind of ["trade", "location"]) {
    await call(ap, sql<object>`select app.set_participant_visibility(${participantId}::uuid, ${kind}, true, '{}'::uuid[], now())`);
    await visibility(ap, kind, "all");
  }
  await visibility(narrow, "trade", "all");
  await visibility(narrow, "location", [buildingA]);
  const item = async (type: string, title: string, location: string) => {
    const [created] = await call<{ outcome: string; work_item_id: string }>(
      ap,
      sql`select outcome, work_item_id from app.create_work_item(
        ${projectId}::uuid, ${type}, ${title}, app.latest_form_version(${type}), '{}'::jsonb,
        ${electrical}::uuid, ${location}::uuid, now())`,
    );
    expect(created!.outcome).toBe("created");
    return created!.work_item_id;
  };
  const from = await item(TYPE, "Cable trays for Tower 2", buildingA);
  const seen = await item("MAR", "Approved copper cables", buildingA);
  const hidden = await item("MAR", "Approved busbars", buildingB);
  const draft = await item("MAR", "Fire stopping", buildingA);
  await submit(seen, `${code}-MAR-01-0001`);
  const hiddenNumber = `${code}-MAR-01-0002`;
  await submit(hidden, hiddenNumber);
  return { ap, narrow, projectId, electrical, buildingA, from, seen, hidden, hiddenNumber, draft };
}

const answers = (as: string, item: string) =>
  call<{ answers: Record<string, unknown> | null }>(as, sql`select app.work_item_answers(${item}::uuid) as answers`).then(
    (rows) => rows[0]!.answers,
  );

/** As the owner, the answers a save would have stored. */
const write = (item: string, data: Record<string, unknown>) =>
  migrator.query("update work_item set data = $1 where id = $2", [JSON.stringify(data), item]);

/** The acting Member saves the item's answers (`related` only), as the API does. */
const save = (as: string, side: Side, related: unknown[]) =>
  call<{ outcome: string }>(
    as,
    sql`select app.save_work_item_answers(${side.from}::uuid, ${JSON.stringify({ related })}::jsonb,
      ${side.electrical}::uuid, ${side.buildingA}::uuid, '{}'::uuid[], now()) as outcome`,
  ).then((rows) => rows[0]!.outcome);

/** The link question's Links as the Authorized Person reads them, by target id. */
const reliesOn = (side: Side) =>
  call<{ kind: string; field_key: string | null; work_item_id: string | null }>(
    side.ap,
    sql`select kind, field_key, work_item_id from app.work_item_links(${side.from}::uuid)`,
  ).then((rows) => rows.map((r) => [r.kind, r.field_key, r.work_item_id]).sort((x, y) => String(x[2]).localeCompare(String(y[2]))));
const sorted = (...links: string[][]) => links.sort((x, y) => x[2]!.localeCompare(y[2]!));

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  await addLinkType();
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  a = await side(engineer, "A", "AAA");
  b = await side(engineer, "B", "BBB");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("reading a link question's answer (scenario 81)", () => {
  beforeAll(() => write(a.from, { related: [a.seen, a.hidden] }));

  it("gives a reader who sees every chosen item their ids, in the order chosen", async () => {
    expect(await answers(a.ap, a.from)).toEqual({ related: [a.seen, a.hidden], trade: a.electrical, location: a.buildingA });
  });

  it("replaces an item the reader can't see by its Document Number and Subject, never its id", async () => {
    const read = await answers(a.narrow, a.from);
    expect(read).toMatchObject({ related: [a.seen, { document_number: a.hiddenNumber, subject: "Approved busbars" }] });
    expect(JSON.stringify(read)).not.toContain(a.hidden);
  });

  it("never names an item of another Project, nor an id that names no item", async () => {
    await write(a.from, { related: [b.seen, randomUUID(), a.seen] });
    try {
      const answered = await answers(a.ap, a.from);
      expect(answered).toMatchObject({ related: [a.seen] });
      const read = JSON.stringify(answered);
      expect(read).not.toContain(b.seen);
      expect(read).not.toContain("BBB-MAR");
    } finally {
      await write(a.from, { related: [a.seen, a.hidden] });
    }
  });

  it("answers null to a Member of another Project", async () => {
    expect(await answers(b.ap, a.from)).toBeNull();
  });
});

describe("saving a link question's answer", () => {
  beforeAll(async () => {
    await write(a.from, {});
    expect(await save(a.ap, a, [])).toBe("saved");
  });

  it("makes the field's relies_on Links match the answer: added and removed", async () => {
    expect(await save(a.ap, a, [a.seen, a.hidden])).toBe("saved");
    expect(await reliesOn(a)).toEqual(sorted(["relies_on", "related", a.seen], ["relies_on", "related", a.hidden]));
    expect(await save(a.ap, a, [a.hidden])).toBe("saved");
    expect(await reliesOn(a)).toEqual([["relies_on", "related", a.hidden]]);
    expect(await answers(a.ap, a.from)).toMatchObject({ related: [a.hidden] });
  });

  it("keeps an item the saver can't see when it comes back as its number and Subject, and drops it when it doesn't", async () => {
    expect(await save(a.ap, a, [a.seen, a.hidden])).toBe("saved");
    const asRead = (await answers(a.narrow, a.from))!.related as unknown[];
    expect(await save(a.narrow, a, asRead)).toBe("saved");
    expect(await answers(a.ap, a.from)).toMatchObject({ related: [a.seen, a.hidden] });
    expect(await reliesOn(a)).toEqual(sorted(["relies_on", "related", a.seen], ["relies_on", "related", a.hidden]));
    expect(await save(a.narrow, a, [a.seen])).toBe("saved");
    expect(await answers(a.ap, a.from)).toMatchObject({ related: [a.seen] });
    expect(await reliesOn(a)).toEqual([["relies_on", "related", a.seen]]);
  });

  it("refuses alike, changing nothing, any item Link search couldn't have offered the saver", async () => {
    expect(await save(a.ap, a, [a.seen])).toBe("saved");
    for (const refused of [
      [a.hidden], // hidden from the narrow Member, even by its id
      [{ document_number: a.hiddenNumber, subject: "Approved busbars" }], // not chosen before
      [a.draft],
      [b.seen],
      [randomUUID()],
      [a.from],
    ]) {
      expect(await save(a.narrow, a, refused), JSON.stringify(refused)).toBe("target_not_found");
    }
    expect(await answers(a.ap, a.from)).toMatchObject({ related: [a.seen] });
    expect(await reliesOn(a)).toEqual([["relies_on", "related", a.seen]]);
  });

  // Submitted at least once, it stays in Link search (RP-295, scenario 58).
  it("keeps an item already chosen that has been Sent Back to its raiser's Draft, and takes it as a new choice too", async () => {
    expect(await save(a.ap, a, [a.seen])).toBe("saved");
    await unsubmit(a.seen);
    try {
      expect(await save(a.narrow, a, [a.seen])).toBe("saved");
      expect(await answers(a.ap, a.from)).toMatchObject({ related: [a.seen] });
      expect(await reliesOn(a)).toEqual([["relies_on", "related", a.seen]]);
      expect(await save(a.narrow, a, [])).toBe("saved");
      expect(await reliesOn(a)).toEqual([]);
      expect(await save(a.narrow, a, [a.seen])).toBe("saved");
      expect(await reliesOn(a)).toEqual([["relies_on", "related", a.seen]]);
    } finally {
      await submit(a.seen, "AAA-MAR-01-0001");
    }
  });

  it("refuses by its id an item already chosen that the saver can't see, like any other", async () => {
    expect(await save(a.ap, a, [a.seen, a.hidden])).toBe("saved");
    expect(await save(a.narrow, a, [a.seen, a.hidden])).toBe("target_not_found");
    expect(await answers(a.ap, a.from)).toMatchObject({ related: [a.seen, a.hidden] });
  });
});
