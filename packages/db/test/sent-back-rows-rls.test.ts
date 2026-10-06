// Seam 2 for an item Sent Back to its raiser (RP-309; ADR 0013, ADR 0014;
// visibility.md V1, V19, the Links, Linked from, Link search and File downloads
// channels, scenarios 58 and 59), as the app role. While C1 holds the item again,
// a Consultant Member and the Owner still see it, and read its Documents and
// Links as they were at the Send Back, whatever they query: the tables
// themselves, app.work_item_links, app.work_item_linked_from. What C1 adds or
// removes is C1's until it Submits the item again; then it is everyone's, and the
// Transition event's content hash still covers the Subject and the answers.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { addSendBackWorkflow, joinProject, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;
const TYPE = "SBRLS";

let migrator: pg.Client;
let app: Db;

type Company = { id: string; cr: string; ap: string; member: string };
let c1: Company; // Contractor: raises the items.
let k1: Company; // Consultant: Sends the item Back.
let ow: Company; // Owner (oversight).
let c1Pm = "";
let projectId = "";
let electrical = "";
let buildingA = "";

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

async function member(companyId: string, who: string, creator = false): Promise<string> {
  return one(
    "insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', $4) returning id",
    [companyId, email(who), JSON.stringify({ en: who, ar: who }), creator],
  );
}

async function company(engineer: string, name: string): Promise<Company> {
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
const outcome = (as: string, query: ReturnType<typeof sql<{ outcome: string }>>) => call(as, query).then((rows) => rows[0]!.outcome);

/** A test-only Type on the test Workflow with a Send Back, its Form with a file field and a link question. */
async function addType() {
  const schema = {
    sections: [
      {
        key: "material",
        title: { en: "Material", ar: "المادة" },
        fields: [
          { key: "model", type: "text", label: { en: "Model", ar: "الطراز" } },
          { key: "datasheet", type: "attachments", label: { en: "Datasheet", ar: "نشرة البيانات" } },
          { key: "related", type: "work_item_ref", label: { en: "Related submittals", ar: "التقديمات ذات الصلة" } },
        ],
      },
      {
        key: "classification",
        title: { en: "Classification", ar: "التصنيف" },
        fields: [
          { key: "trade", type: "trade", label: { en: "Trade", ar: "التخصص" } },
          { key: "location", type: "location", label: { en: "Location", ar: "الموقع" } },
        ],
      },
    ],
  };
  const workflowId = await addSendBackWorkflow((text) => migrator.query(text));
  await migrator.query(`
    do $$
      declare
        v_form uuid;
      begin
        if exists (select 1 from work_item_type where owner_kind = 'rabaed' and code = '${TYPE}') then return; end if;
        insert into form_definition (owner_kind, name) values ('rabaed', '{"en": "Sent Back rows", "ar": "صفوف الإرجاع"}')
        returning id into v_form;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_form, 1, 'published', now(), '${JSON.stringify(schema)}'::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        values ('rabaed', 'submittals', '${TYPE}', '{"en": "Sent Back rows", "ar": "صفوف الإرجاع"}', '${workflowId}', 'review_code', v_form);
      end
    $$`);
}

const take = (as: string, id: string, transition: string) =>
  outcome(
    as,
    sql`select app.take_transition(${id}::uuid, ${transition}, '{}'::jsonb, '', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
  );
const claim = (as: string, id: string) => outcome(as, sql`select app.claim_step(${id}::uuid, now()) as outcome`);
const save = (as: string, id: string, data: object) =>
  outcome(
    as,
    sql`select app.save_work_item_answers(${id}::uuid, ${JSON.stringify(data)}::jsonb, ${electrical}::uuid, ${buildingA}::uuid, '{}'::uuid[], now()) as outcome`,
  );

async function draft(model: string, data: object = {}): Promise<string> {
  const [created] = await call<{ outcome: string; work_item_id: string }>(
    c1.member,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, ${TYPE}, ${model}, app.latest_form_version(${TYPE}), ${JSON.stringify({ model, ...data })}::jsonb,
      ${electrical}::uuid, ${buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  // As the API does: a link question's items get their Links with the save.
  expect(await save(c1.member, created!.work_item_id, { model, ...data })).toBe("saved");
  return created!.work_item_id;
}

async function submit(id: string) {
  expect(await take(c1.member, id, "send_for_review")).toBe("applied");
  expect(await claim(c1Pm, id)).toBe("claimed");
  expect(await take(c1Pm, id, "submit")).toBe("applied");
}

/** A confirmed Document of item `id`, uploaded by the C1 engineer (into `field`, or the Attachments System Field). */
async function document(id: string, fileName: string, field: string | null = null): Promise<string> {
  const [started] = await call<{ outcome: string; document_id: string }>(
    c1.member,
    sql`select outcome, document_id from app.start_document_upload(${id}::uuid, ${fileName}, 10, 'application/pdf', now(), ${field})`,
  );
  expect(started!.outcome).toBe("started");
  expect(
    await outcome(c1.member, sql`select app.confirm_document_upload(${id}::uuid, ${started!.document_id}::uuid, 10, 'application/pdf', now()) as outcome`),
  ).toBe("confirmed");
  return started!.document_id;
}

const addLink = async (id: string, to: string) => {
  const [added] = await call<{ outcome: string; link_id: string }>(
    c1.member,
    sql`select outcome, link_id from app.add_work_item_link(${id}::uuid, ${to}::uuid, now())`,
  );
  expect(added!.outcome).toBe("added");
  return added!.link_id;
};

/** What `as` reads of item `id`, from the tables themselves and through the functions. */
const reads = async (as: string, id: string) => ({
  documents: (await call<{ id: string }>(as, sql`select id from document where work_item_id = ${id} order by id`)).map((r) => r.id),
  linkRows: (await call<{ id: string }>(as, sql`select id from work_item_link where from_id = ${id} order by id`)).map((r) => r.id),
  links: (
    await call<{ kind: string; work_item_id: string }>(as, sql`select kind, work_item_id from app.work_item_links(${id}::uuid) order by kind`)
  ).map((r) => `${r.kind}:${r.work_item_id}`),
});
const linkedFrom = async (as: string, id: string) =>
  (await call<{ work_item_id: string }>(as, sql`select work_item_id from app.work_item_linked_from(${id}::uuid)`)).map((r) => r.work_item_id);
const offered = async (as: string, id: string) =>
  (await call<{ submitted: boolean }>(as, sql`select app.work_item_submitted(${id}::uuid) as submitted`))[0]!.submitted;

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  await addType();
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  c1 = await company(engineer, "C1");
  k1 = await company(engineer, "K1");
  ow = await company(engineer, "OW");
  c1Pm = await member(c1.id, "pm");

  const [created] = await call<{ project_id: string }>(
    c1.ap,
    sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, 'TWR', 'contractor')`,
  );
  projectId = created!.project_id;
  const participant = {
    c1: (await migrator.query("select id from participant where project_id = $1", [projectId])).rows[0].id as string,
    k1: await joinProject(app, projectId, { adminId: c1.ap, crNumber: k1.cr, role: "consultant" }, k1.ap),
    ow: await joinProject(app, projectId, { adminId: c1.ap, crNumber: ow.cr, role: "owner" }, ow.ap),
  };
  const value = async (kind: string, code: string) =>
    (
      await call<{ value_id: string }>(
        c1.ap,
        sql`select value_id from app.add_dimension_value(${projectId}::uuid, ${kind}, null, ${code}, ${JSON.stringify({ en: code, ar: code })}::jsonb)`,
      )
    )[0]!.value_id;
  electrical = await value("trade", "EL");
  buildingA = await value("location", "BA");
  const people: [Company, string, string, string[]][] = [
    [c1, participant.c1, c1.member, ["engineer"]],
    [c1, participant.c1, c1Pm, ["project_manager"]],
    [k1, participant.k1, k1.member, ["engineer"]],
    [ow, participant.ow, ow.member, ["representative"]],
  ];
  for (const p of Object.values(participant)) {
    for (const kind of ["trade", "location"]) {
      expect(await outcome(c1.ap, sql`select app.set_participant_visibility(${p}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    }
  }
  for (const [co, p, m, positions] of people) {
    await call(co.ap, sql<{ outcome: string }>`select app.add_project_member(${p}::uuid, ${m}::uuid, now())`);
    for (const kind of ["trade", "location"]) {
      expect(await outcome(co.ap, sql`select app.set_member_visibility(${p}::uuid, ${m}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe(
        "set",
      );
    }
    expect(await outcome(co.ap, sql`select app.set_project_member_positions(${p}::uuid, ${m}::uuid, ${positions}::text[]) as outcome`)).toBe("set");
  }
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("C1 changes an item K1 Sent Back to its Draft", () => {
  let x = "";
  let y = "";
  let id = "";
  let atSendBack: Awaited<ReturnType<typeof reads>>;
  let added: string[] = [];

  beforeAll(async () => {
    x = await draft("X");
    await submit(x);
    y = await draft("Y");
    await submit(y);
    id = await draft("F", { related: [x] });
    await document(id, "datasheet-1.pdf", "datasheet");
    await document(id, "letter-1.pdf");
    const freeToX = await addLink(id, x);
    await submit(id);
    expect(await claim(k1.member, id)).toBe("claimed");
    expect(await take(k1.member, id, "send_back_to_draft")).toBe("applied");
    atSendBack = await reads(k1.member, id);

    added = [await document(id, "datasheet-2.pdf", "datasheet"), await document(id, "letter-2.pdf")];
    expect(await save(c1.member, id, { model: "F", related: [y] })).toBe("saved");
    expect(await outcome(c1.member, sql`select app.remove_work_item_link(${id}::uuid, ${freeToX}::uuid, now()) as outcome`)).toBe("removed");
    await addLink(id, y);
  });

  it("had, at the Send Back, its two Documents and two Links to X", () => {
    expect(atSendBack.documents).toHaveLength(2);
    expect(atSendBack.linkRows).toHaveLength(2);
    expect(atSendBack.links).toEqual([`related:${x}`, `relies_on:${x}`]);
  });

  it("is still the item K1 and the Owner see, and still offered to link", async () => {
    for (const other of [k1.member, ow.member]) {
      expect(await call(other, sql`select id from work_item where id = ${id}`)).toHaveLength(1);
      expect(await offered(other, id)).toBe(true);
    }
  });

  it("shows K1 and the Owner its Documents and Links as they were at the Send Back, from the tables and the functions", async () => {
    for (const other of [k1.member, ow.member]) {
      expect(await reads(other, id)).toEqual(atSendBack);
      for (const document of added) {
        expect(await call(other, sql`select id from document where id = ${document}`)).toEqual([]);
      }
    }
  });

  it("keeps it in X's Linked from and out of Y's for them", async () => {
    for (const other of [k1.member, ow.member]) {
      expect(await linkedFrom(other, x)).toEqual([id]);
      expect(await linkedFrom(other, y)).toEqual([]);
    }
  });

  it("shows C1, holding it, what it has now", async () => {
    const now = await reads(c1.member, id);
    expect(now.documents).toEqual([...atSendBack.documents, ...added].sort());
    expect(now.links).toEqual([`related:${y}`, `relies_on:${y}`]);
    expect(now.linkRows).toHaveLength(2);
    expect(await linkedFrom(c1.member, x)).toEqual([]);
    expect(await linkedFrom(c1.member, y)).toEqual([id]);
  });

  it("never lets the app role read a Link's removal or the item's arrivals", async () => {
    for (const query of [
      sql`select removed_at from work_item_link where from_id = ${id}`,
      sql`select arrival from work_item_link where from_id = ${id}`,
      sql`select arrivals from work_item where id = ${id}`,
    ]) {
      await expect(call(k1.member, query)).rejects.toThrow(/permission denied/);
    }
  });

  it("makes everything everyone's once C1 Submits it again, the Transition hashing the Subject and the answers", async () => {
    await submit(id);
    const c1Reads = await reads(c1.member, id);
    for (const viewer of [k1.member, ow.member]) {
      expect(await reads(viewer, id)).toEqual(c1Reads);
      expect(await linkedFrom(viewer, x)).toEqual([]);
      expect(await linkedFrom(viewer, y)).toEqual([id]);
    }
    // The removed Link to X is gone from the table.
    const { rows } = await migrator.query("select count(*)::int as n from work_item_link where from_id = $1", [id]);
    expect(rows[0].n).toBe(2);
    const { rows: hashed } = await migrator.query(
      `select e.content_sha256 = sha256(convert_to(jsonb_build_object('title', w.title, 'data', w.data)::text, 'UTF8')) as same
       from work_item_event e join work_item w on w.id = e.work_item_id
       join workflow_transition t on t.id = e.transition_id
       where e.work_item_id = $1 and t.key = 'submit' order by e.seq desc limit 1`,
      [id],
    );
    expect(hashed[0].same).toBe(true);
  });
});

describe("a Link C1 adds and removes again while it holds the Sent Back item", () => {
  it("never reaches anyone else, and one it removes and adds back is the same Link", async () => {
    const x = await draft("X2");
    await submit(x);
    const y = await draft("Y2");
    await submit(y);
    const id = await draft("F2");
    const toX = await addLink(id, x);
    await submit(id);
    expect(await claim(k1.member, id)).toBe("claimed");
    expect(await take(k1.member, id, "send_back_to_draft")).toBe("applied");

    const toY = await addLink(id, y);
    expect(await outcome(c1.member, sql`select app.remove_work_item_link(${id}::uuid, ${toY}::uuid, now()) as outcome`)).toBe("removed");
    expect(await outcome(c1.member, sql`select app.remove_work_item_link(${id}::uuid, ${toX}::uuid, now()) as outcome`)).toBe("removed");
    expect((await reads(k1.member, id)).linkRows).toEqual([toX]);
    expect(await addLink(id, x)).toBe(toX);
    expect((await reads(c1.member, id)).linkRows).toEqual([toX]);
    const { rows } = await migrator.query("select count(*)::int as n from work_item_link where from_id = $1", [id]);
    expect(rows[0].n).toBe(1);
  });
});
