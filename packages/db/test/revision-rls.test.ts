// Seam 2 for Revisions (RP-316, spec RP-311; workflow-engine.md §5.4,
// visibility.md the Revisions channel, V1, scenarios 51 and 56), as the app
// role: a Draft Revision is C1's alone. K1 and the Owner, who see the closed
// item, read nothing of the Revision whatever they query (the item, its events,
// assignment, access, values, Documents, answers, history, or a Link to it from
// the closed item), can't create or discard one, and get one refusal whatever
// the reason. The chain's ids are never granted; its Rev number is. A discarded
// Revision is gone for C1 too.
import { randomInt, randomUUID } from "node:crypto";
import { sql, type RawBuilder } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { joinProject, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;
const TYPE = "MARRL";

let migrator: pg.Client;
let app: Db;

type Company = { id: string; cr: string; ap: string; member: string };
let c1: Company; // Contractor: raises the item and its Revision.
let k1: Company; // Consultant: issues Code C.
let ow: Company; // Owner (oversight).
let orA: Company; // Owner Representative covering Building A only.
let orB: Company; // Owner Representative covering Building B only.
let c1Pm = "";
let projectId = "";
let electrical = "";
let buildingA = "";
let buildingB = "";
let closed = "";
let revision = "";

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

const call = <T extends object = Record<string, unknown>>(as: string, query: RawBuilder<T> | RawBuilder<unknown>) =>
  withMember(app, as, (trx) => (query as RawBuilder<T>).execute(trx).then((r) => r.rows));
const outcome = (as: string, query: ReturnType<typeof sql<{ outcome: string }>>) => call(as, query).then((rows) => rows[0]!.outcome);

/** A test-only Type: Draft → Contractor review → Consultant review → Code C. */
async function addType() {
  const schema = {
    sections: [
      { key: "material", title: { en: "Material", ar: "المادة" }, fields: [{ key: "model", type: "text", label: { en: "Model", ar: "الطراز" } }] },
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
  await migrator.query(`
    do $$
      declare
        v_form uuid;
        v_definition uuid;
        v_version uuid;
      begin
        if exists (select 1 from work_item_type where owner_kind = 'rabaed' and code = '${TYPE}') then return; end if;
        insert into form_definition (owner_kind, name) values ('rabaed', '{"en": "Revisions", "ar": "المراجعات"}')
        returning id into v_form;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_form, 1, 'published', now(), '${JSON.stringify(schema)}'::jsonb);
        insert into workflow_definition (owner_kind, name) values ('rabaed', '{"en": "Revisions", "ar": "المراجعات"}')
        returning id into v_definition;
        insert into workflow_version (workflow_definition_id, version_no, status, published_at)
        values (v_definition, 1, 'published', now()) returning id into v_version;
        insert into workflow_step (workflow_version_id, key, name, stage_key, actor_rule, outcome_mode) values
          (v_version, 'draft', '{"en": "Draft", "ar": "مسودة"}', 'draft', '{"base_role": "contractor", "permission": "create"}', 'none'),
          (v_version, 'internal_review', '{"en": "Contractor review", "ar": "مراجعة المقاول"}', 'internal_review',
            '{"base_role": "contractor", "permission": "review"}', 'none'),
          (v_version, 'consultant_review', '{"en": "Consultant review", "ar": "مراجعة الاستشاري"}', 'pending_approval',
            '{"base_role": "consultant", "permission": "review"}', 'issue_code'),
          (v_version, 'revise_resubmit', '{"en": "Revise & Resubmit", "ar": "مراجعة وإعادة تقديم"}', 'revise_resubmit', '{}', 'none');
        insert into workflow_transition (workflow_version_id, key, from_step_id, to_step_id, label, kind, outcome, permission, sort)
        select v_version, t.key, f.id, s.id, t.label::jsonb, t.kind, t.outcome, t.permission, t.sort
        from (values
          ('send_for_review', 'draft', 'internal_review', '{"en": "Send", "ar": "إرسال"}', 'send', null, 'create', 1),
          ('submit', 'internal_review', 'consultant_review', '{"en": "Submit", "ar": "تقديم"}', 'submit', null, 'submit', 2),
          ('revise_c', 'consultant_review', 'revise_resubmit', '{"en": "C", "ar": "C"}', 'close', 'C', 'review', 3)
        ) as t (key, from_key, to_key, label, kind, outcome, permission, sort)
        join workflow_step f on f.workflow_version_id = v_version and f.key = t.from_key
        join workflow_step s on s.workflow_version_id = v_version and s.key = t.to_key;
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        values ('rabaed', 'submittals', '${TYPE}', '{"en": "Revisions", "ar": "المراجعات"}', v_definition, 'review_code', v_form);
      end
    $$`);
}

const take = (as: string, id: string, transition: string) =>
  outcome(
    as,
    sql`select app.take_transition(${id}::uuid, ${transition}, '{}'::jsonb, '', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
  );
const claim = (as: string, id: string) => outcome(as, sql`select app.claim_step(${id}::uuid, now()) as outcome`);
const createRevision = (as: string, id: string) =>
  call<{ outcome: string; work_item_id: string | null }>(
    as,
    sql`select outcome, work_item_id from app.create_revision(${id}::uuid, ${randomUUID()}::uuid, now())`,
  ).then((rows) => rows[0]!);

/** Everything `as` can read of item `id` through the app role. */
async function everythingOf(as: string, id: string) {
  return {
    item: await call(as, sql`select id from work_item where id = ${id}`),
    events: await call(as, sql`select seq from work_item_event where work_item_id = ${id}`),
    assignments: await call(as, sql`select id from step_assignment where work_item_id = ${id}`),
    access: await call(as, sql`select participant_id from work_item_access where work_item_id = ${id}`),
    values: await call(as, sql`select dimension_value_id from work_item_dimension_value where work_item_id = ${id}`),
    documents: await call(as, sql`select id from document where work_item_id = ${id}`),
    answers: (await call<{ a: unknown }>(as, sql`select app.work_item_answers(${id}::uuid) as a`))[0]!.a,
    history: await call(as, sql`select seq from app.work_item_history(${id}::uuid)`),
  };
}
const nothing = { item: [], events: [], assignments: [], access: [], values: [], documents: [], answers: null, history: [] };

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  await addType();
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  c1 = await company(engineer, "C1");
  k1 = await company(engineer, "K1");
  ow = await company(engineer, "OW");
  orA = await company(engineer, "ORA");
  orB = await company(engineer, "ORB");
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
    orA: await joinProject(app, projectId, { adminId: c1.ap, crNumber: orA.cr, role: "owner_representative" }, orA.ap),
    orB: await joinProject(app, projectId, { adminId: c1.ap, crNumber: orB.cr, role: "owner_representative" }, orB.ap),
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
  buildingB = await value("location", "BB");
  const people: [Company, string, string, string[]][] = [
    [c1, participant.c1, c1.member, ["engineer"]],
    [c1, participant.c1, c1Pm, ["project_manager"]],
    [k1, participant.k1, k1.member, ["engineer"]],
    [ow, participant.ow, ow.member, ["representative"]],
    [orA, participant.orA, orA.member, ["engineer"]],
    [orB, participant.orB, orB.member, ["engineer"]],
  ];
  // Each Owner Representative covers one Building only.
  const covers: Record<string, string> = { orA: buildingA, orB: buildingB };
  for (const [key, p] of Object.entries(participant)) {
    for (const kind of ["trade", "location"]) {
      const only = kind === "location" ? covers[key] : undefined;
      expect(
        await outcome(
          c1.ap,
          sql`select app.set_participant_visibility(${p}::uuid, ${kind}, ${only === undefined}, ${only === undefined ? [] : [only]}::uuid[], now()) as outcome`,
        ),
      ).toBe("set");
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

  const [draft] = await call<{ outcome: string; work_item_id: string }>(
    c1.member,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, ${TYPE}, 'Fire doors', app.latest_form_version(${TYPE}), '{"model": "FD-90"}'::jsonb,
      ${electrical}::uuid, ${buildingA}::uuid, now())`,
  );
  closed = draft!.work_item_id;
  expect(await take(c1.member, closed, "send_for_review")).toBe("applied");
  expect(await claim(c1Pm, closed)).toBe("claimed");
  expect(await take(c1Pm, closed, "submit")).toBe("applied");
  expect(await claim(k1.member, closed)).toBe("claimed");
  expect(await take(k1.member, closed, "revise_c")).toBe("applied");

  const created1 = await createRevision(c1.member, closed);
  expect(created1.outcome).toBe("created");
  revision = created1.work_item_id!;
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("a Draft Revision (scenario 51)", () => {
  it("is C1's, with its Rev number", async () => {
    expect(await call(c1.member, sql`select revision_no from work_item where id = ${revision}`)).toEqual([{ revision_no: 1 }]);
    expect(await call(c1Pm, sql`select id from work_item where id = ${revision}`)).toEqual([{ id: revision }]);
    expect((await everythingOf(c1.member, revision)).answers).toMatchObject({ model: "FD-90" });
  });

  it("returns nothing to K1 or the Owner, who see the closed item", async () => {
    for (const other of [k1.member, ow.member]) {
      expect(await call(other, sql`select id from work_item where id = ${closed}`)).toEqual([{ id: closed }]);
      expect(await everythingOf(other, revision)).toEqual(nothing);
      expect(await call(other, sql`select id from work_item_link where from_id = ${closed}`)).toEqual([]);
      expect(await call(other, sql`select id from app.work_item_links(${closed}::uuid)`)).toEqual([]);
      expect(await call(other, sql`select * from app.work_item_linked_from(${closed}::uuid)`)).toEqual([]);
    }
  });

  it("can't be created again, nor discarded, by K1 or the Owner, and the refusal names nothing", async () => {
    for (const other of [k1.member, ow.member]) {
      expect(await createRevision(other, closed)).toEqual({ outcome: "revision_not_allowed", work_item_id: null });
      expect(await outcome(other, sql`select app.discard_revision(${revision}::uuid, now()) as outcome`)).toBe("not_found");
      expect(await call(other, sql`select app.can_create_revision(${closed}::uuid) as can`)).toEqual([{ can: false }]);
    }
    // C1 gets the same answer while its Revision is open.
    expect(await createRevision(c1.member, closed)).toEqual({ outcome: "revision_not_allowed", work_item_id: null });
  });

  it("never gives the app role the chain's ids", async () => {
    await expect(call(c1.member, sql`select revision_of_id from work_item where id = ${revision}`)).rejects.toThrow(/permission denied/);
    await expect(call(c1.member, sql`select root_id from work_item where id = ${revision}`)).rejects.toThrow(/permission denied/);
    await expect(call(c1.member, sql`select copied_from_id from document_copy`)).rejects.toThrow(/permission denied/);
  });
});

// The Revision drop-down (RP-318): app.revision_chain lists the Revisions of an
// item's chain the caller sees, each by V1 on its own; nothing for an item the
// caller can't see.
const chain = (as: string, id: string) =>
  call<{ work_item_id: string; document_number: string | null; revision_no: number }>(
    as,
    sql`select work_item_id, document_number, revision_no from app.revision_chain(${id}::uuid)`,
  );

describe("the chain, as the Revision drop-down reads it (scenario 51)", () => {
  it("lists the Draft Revision to C1 after the original, with no number yet", async () => {
    const number = (await call<{ document_number: string }>(c1.member, sql`select document_number from work_item where id = ${closed}`))[0]!
      .document_number;
    const expected = [
      { work_item_id: closed, document_number: number, revision_no: 0 },
      { work_item_id: revision, document_number: null, revision_no: 1 },
    ];
    expect(await chain(c1.member, closed)).toEqual(expected);
    expect(await chain(c1Pm, revision)).toEqual(expected);
  });

  it("lists only the original to K1 and the Owner, and nothing from the Draft Revision's id", async () => {
    for (const other of [k1.member, ow.member]) {
      expect((await chain(other, closed)).map((r) => r.work_item_id)).toEqual([closed]);
      expect(await chain(other, revision)).toEqual([]);
      expect(await chain(other, randomUUID())).toEqual([]);
    }
  });
});

// The Link the engine adds from the revised item to its Revision at the Revision's
// first Submit (RP-316) follows the drop-down: a reader who sees one item of the
// chain but not another never reads the other through a Link or Linked from, not
// even by its number and Subject.
describe("the Links between the items of a chain, for a reader who sees only some of them (scenario 62)", () => {
  let original = "";
  let moved = ""; // Rev 1, moved to Building B.
  const links = (as: string, id: string) =>
    call<{ kind: string; document_number: string | null }>(as, sql`select kind, document_number from app.work_item_links(${id}::uuid)`);
  const linkedFrom = (as: string, id: string) =>
    call<{ document_number: string }>(as, sql`select document_number from app.work_item_linked_from(${id}::uuid)`);

  beforeAll(async () => {
    const [draft] = await call<{ outcome: string; work_item_id: string }>(
      c1.member,
      sql`select outcome, work_item_id from app.create_work_item(
        ${projectId}::uuid, ${TYPE}, 'Smoke dampers', app.latest_form_version(${TYPE}), '{"model": "SD-1"}'::jsonb,
        ${electrical}::uuid, ${buildingA}::uuid, now())`,
    );
    original = draft!.work_item_id;
    expect(await take(c1.member, original, "send_for_review")).toBe("applied");
    expect(await claim(c1Pm, original)).toBe("claimed");
    expect(await take(c1Pm, original, "submit")).toBe("applied");
    expect(await claim(k1.member, original)).toBe("claimed");
    expect(await take(k1.member, original, "revise_c")).toBe("applied");
    moved = (await createRevision(c1.member, original)).work_item_id!;
    expect(
      await outcome(
        c1.member,
        sql`select app.save_work_item_answers(${moved}::uuid, '{"model": "SD-2"}'::jsonb, ${electrical}::uuid, ${buildingB}::uuid, '{}'::uuid[], now()) as outcome`,
      ),
    ).toBe("saved");
    expect(await take(c1.member, moved, "send_for_review")).toBe("applied");
    expect(await claim(c1Pm, moved)).toBe("claimed");
    expect(await take(c1Pm, moved, "submit")).toBe("applied");
  }, 20_000);

  it("gives a reader of both the Link to the Revision, and its Linked from", async () => {
    for (const who of [c1.member, k1.member, ow.member]) {
      expect((await links(who, original)).map((l) => l.kind)).toEqual(["related"]);
      expect(await linkedFrom(who, moved)).toHaveLength(1);
    }
  });

  it("leaves the Revision out of the original's Links for a reader who sees only the original", async () => {
    expect(await call(orA.member, sql`select id from work_item where id = ${original}`)).toEqual([{ id: original }]);
    expect(await call(orA.member, sql`select id from work_item where id = ${moved}`)).toEqual([]);
    expect(await links(orA.member, original)).toEqual([]);
    expect((await chain(orA.member, original)).map((r) => r.work_item_id)).toEqual([original]);
  });

  it("leaves the original out of the Revision's Linked from for a reader who sees only the Revision", async () => {
    expect(await call(orB.member, sql`select id from work_item where id = ${moved}`)).toEqual([{ id: moved }]);
    expect(await call(orB.member, sql`select id from work_item where id = ${original}`)).toEqual([]);
    expect(await linkedFrom(orB.member, moved)).toEqual([]);
    expect((await chain(orB.member, moved)).map((r) => r.work_item_id)).toEqual([moved]);
  });
});

// Only Code C opens a Revision: Inspection Revisions (`failed`) are out of scope (RP-311 review).
describe("an item closed otherwise than with Code C", () => {
  it("can't be revised, with the one refusal", async () => {
    const [draft] = await call<{ outcome: string; work_item_id: string }>(
      c1.member,
      sql`select outcome, work_item_id from app.create_work_item(
        ${projectId}::uuid, ${TYPE}, 'Sprinklers', app.latest_form_version(${TYPE}), '{"model": "SP-1"}'::jsonb,
        ${electrical}::uuid, ${buildingA}::uuid, now())`,
    );
    const id = draft!.work_item_id;
    expect(await take(c1.member, id, "send_for_review")).toBe("applied");
    expect(await claim(c1Pm, id)).toBe("claimed");
    expect(await take(c1Pm, id, "submit")).toBe("applied");
    expect(await claim(k1.member, id)).toBe("claimed");
    expect(await take(k1.member, id, "revise_c")).toBe("applied");
    expect(await call(c1.member, sql`select app.can_create_revision(${id}::uuid) as can`)).toEqual([{ can: true }]);
    // As an Inspection that failed would close.
    await migrator.query("update work_item set outcome = 'failed' where id = $1", [id]);
    expect(await call(c1.member, sql`select app.can_create_revision(${id}::uuid) as can`)).toEqual([{ can: false }]);
    expect(await createRevision(c1.member, id)).toEqual({ outcome: "revision_not_allowed", work_item_id: null });
  });
});

describe("a discarded Revision (scenario 56)", () => {
  it("is gone for C1 too, and the next one is Rev 1 again", async () => {
    expect(await outcome(c1.member, sql`select app.discard_revision(${revision}::uuid, now()) as outcome`)).toBe("discarded");
    for (const who of [c1.member, c1Pm, k1.member, ow.member]) expect(await everythingOf(who, revision)).toEqual(nothing);
    expect((await chain(c1.member, closed)).map((r) => r.work_item_id)).toEqual([closed]);
    expect(await chain(c1.member, revision)).toEqual([]);
    // Kept, with when its Draft was started, for audit: a Work Item is never deleted (RP-334).
    const kept = await migrator.query("select created_at, discarded_at from work_item where id = $1", [revision]);
    expect(kept.rows).toEqual([{ created_at: expect.any(Date), discarded_at: expect.any(Date) }]);
    const again = await createRevision(c1.member, closed);
    expect(again.outcome).toBe("created");
    expect(await call(c1.member, sql`select revision_no from work_item where id = ${again.work_item_id}`)).toEqual([{ revision_no: 1 }]);
  });
});
