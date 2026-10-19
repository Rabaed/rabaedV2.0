// Seam 2 for the Documents a Documental Record holds (RP-147; visibility.md V19, the Documental
// Record row, scenarios RP-147-1 and RP-147-2): app.documents_shared_before_close, the record's
// own rule, read by app.documental_record_facts as the owner. It gives a closed item's Documents
// the other Participants saw before the close: never one of an item never Submitted, never one
// removed in the Draft, never one its holder added after the last arrival; one added after a Send
// Back once the item was Submitted again, and a Revision's copies once the Revision was. The app
// role can't call it.
import { createHash, randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { addTestWorkflow, joinProject, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;
const TYPE = "RCDOC";

let migrator: pg.Client;
let app: Db;

type Company = { id: string; cr: string; ap: string; member: string };
let c1: Company;
let k1: Company;
let c1Pm = "";
let k1Manager = "";
let projectId = "";
let electrical = "";
let buildingA = "";

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

async function member(companyId: string, who: string, creator = false): Promise<string> {
  return one("insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', $4) returning id", [
    companyId,
    email(who),
    JSON.stringify({ en: who, ar: who }),
    creator,
  ]);
}

async function company(engineer: string, name: string): Promise<Company> {
  const cr = digits(10);
  const id = await one("insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id", [
    JSON.stringify({ en: name, ar: name }),
    cr,
    `3${digits(13)}3`,
    engineer,
  ]);
  const ap = await member(id, "ap", true);
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [ap, id]);
  return { id, cr, ap, member: await member(id, "engineer") };
}

const call = <T extends object>(as: string, query: ReturnType<typeof sql<T>>) => withMember(app, as, (trx) => query.execute(trx).then((r) => r.rows));
const outcome = (as: string, query: ReturnType<typeof sql<{ outcome: string }>>) => call(as, query).then((rows) => rows[0]!.outcome);

async function addType() {
  const schema = {
    sections: [
      {
        key: "material",
        title: { en: "Material", ar: "المادة" },
        fields: [
          { key: "model", type: "text", label: { en: "Model", ar: "الطراز" } },
          { key: "datasheet", type: "attachments", label: { en: "Datasheet", ar: "نشرة البيانات" } },
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
  const workflowId = await addTestWorkflow((text) => migrator.query(text), { withCancel: true });
  await migrator.query(`
    do $$
      declare
        v_form uuid;
      begin
        if exists (select 1 from work_item_type where owner_kind = 'rabaed' and code = '${TYPE}') then return; end if;
        insert into form_definition (owner_kind, name) values ('rabaed', '{"en": "Record Documents", "ar": "مستندات السجل"}')
        returning id into v_form;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_form, 1, 'published', now(), '${JSON.stringify(schema)}'::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        values ('rabaed', 'submittals', '${TYPE}', '{"en": "Record Documents", "ar": "مستندات السجل"}', '${workflowId}', 'review_code', v_form);
      end
    $$`);
}

const take = (as: string, id: string, transition: string) =>
  outcome(
    as,
    sql`select app.take_transition(${id}::uuid, ${transition}, '{}'::jsonb, '', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
  );
const pickUp = (as: string, id: string) => outcome(as, sql`select app.pick_up_step(${id}::uuid, now()) as outcome`);

async function draft(model: string): Promise<string> {
  const [created] = await call<{ outcome: string; work_item_id: string }>(
    c1.member,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, ${TYPE}, ${model}, app.latest_form_version(${TYPE}), ${JSON.stringify({ model })}::jsonb,
      ${electrical}::uuid, ${buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  return created!.work_item_id;
}

async function submit(id: string) {
  expect(await take(c1.member, id, "send_for_review")).toBe("applied");
  expect(await pickUp(c1Pm, id)).toBe("picked_up");
  expect(await take(c1Pm, id, "submit")).toBe("applied");
}

async function code(id: string, transition: "approve_a" | "revise_c") {
  expect(await pickUp(k1.member, id)).toBe("picked_up");
  expect(await take(k1.member, id, "send_to_manager")).toBe("applied");
  expect(await pickUp(k1Manager, id)).toBe("picked_up");
  expect(await take(k1Manager, id, transition)).toBe("applied");
}

async function sendBackToDraft(id: string) {
  expect(await pickUp(k1.member, id)).toBe("picked_up");
  expect(await take(k1.member, id, "send_back_to_draft")).toBe("applied");
}

const fingerprint = (fileName: string) => createHash("sha256").update(fileName, "utf8").digest();

/** A confirmed Document of item `id`, uploaded by the C1 engineer into the `datasheet` field. */
async function document(id: string, fileName: string): Promise<string> {
  const [started] = await call<{ outcome: string; document_id: string }>(
    c1.member,
    sql`select outcome, document_id from app.start_document_upload(${id}::uuid, ${fileName}, 10, 'application/pdf', now(), 'datasheet')`,
  );
  expect(started!.outcome).toBe("started");
  expect(
    await outcome(
      c1.member,
      sql`select app.confirm_document_upload(${id}::uuid, ${started!.document_id}::uuid, 10, 'application/pdf', ${fingerprint(fileName)}, now()) as outcome`,
    ),
  ).toBe("confirmed");
  return started!.document_id;
}

/** The record's Documents of closed item `id`, by file name in the order added, as the owner (the record job) reads them. */
const recordDocuments = async (id: string): Promise<string[]> =>
  (await migrator.query("select file_name from app.documents_shared_before_close($1) order by created_at, id", [id])).rows.map((r) => r.file_name as string);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  await addType();
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  c1 = await company(engineer, "C1");
  k1 = await company(engineer, "K1");
  c1Pm = await member(c1.id, "pm");
  k1Manager = await member(k1.id, "manager");
  const [created] = await call<{ project_id: string }>(c1.ap, sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, 'RCD', 'contractor')`);
  projectId = created!.project_id;
  const participant = {
    c1: (await migrator.query("select id from participant where project_id = $1", [projectId])).rows[0].id as string,
    k1: await joinProject(app, projectId, { adminId: c1.ap, crNumber: k1.cr, role: "consultant" }, k1.ap),
  };
  const value = async (kind: string, valueCode: string) =>
    (
      await call<{ value_id: string }>(
        c1.ap,
        sql`select value_id from app.add_dimension_value(${projectId}::uuid, ${kind}, null, ${valueCode}, ${JSON.stringify({ en: valueCode, ar: valueCode })}::jsonb)`,
      )
    )[0]!.value_id;
  electrical = await value("trade", "EL");
  buildingA = await value("location", "BA");
  for (const p of Object.values(participant)) {
    for (const kind of ["trade", "location"]) {
      expect(await outcome(c1.ap, sql`select app.set_participant_visibility(${p}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    }
  }
  const people: [Company, string, string, string[]][] = [
    [c1, participant.c1, c1.member, ["engineer"]],
    [c1, participant.c1, c1Pm, ["project_manager"]],
    [k1, participant.k1, k1.member, ["engineer"]],
    [k1, participant.k1, k1Manager, ["manager"]],
  ];
  for (const [co, p, m, positions] of people) {
    await call(co.ap, sql<{ outcome: string }>`select app.add_project_member(${p}::uuid, ${m}::uuid, now())`);
    for (const kind of ["trade", "location"]) {
      expect(await outcome(co.ap, sql`select app.set_member_visibility(${p}::uuid, ${m}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    }
    expect(await outcome(co.ap, sql`select app.set_project_member_positions(${p}::uuid, ${m}::uuid, ${positions}::text[]) as outcome`)).toBe("set");
  }
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("app.documents_shared_before_close: the Documents a closed item's record holds", () => {
  it("holds the Draft's files once the item was Submitted, never one removed in the Draft", async () => {
    const id = await draft("Draft files");
    await document(id, "kept.pdf");
    const removed = await document(id, "removed.pdf");
    expect(await outcome(c1.member, sql`select app.remove_document(${id}::uuid, ${removed}::uuid, now()) as outcome`)).toBe("removed");
    await submit(id);
    await code(id, "approve_a");
    expect(await recordDocuments(id)).toEqual(["kept.pdf"]);
  });

  it("holds nothing of an item Cancelled in its Draft: nobody else ever saw it", async () => {
    const id = await draft("Never submitted");
    await document(id, "draft-only.pdf");
    expect(await take(c1.member, id, "cancel")).toBe("applied");
    expect(await recordDocuments(id)).toEqual([]);
  });

  it("holds one added after a Send Back once the item was Submitted again", async () => {
    const id = await draft("Resubmitted");
    await document(id, "first.pdf");
    await submit(id);
    await sendBackToDraft(id);
    await document(id, "after-send-back.pdf");
    await submit(id);
    await code(id, "approve_a");
    expect(await recordDocuments(id)).toEqual(["first.pdf", "after-send-back.pdf"]);
  });

  it("never holds one its holder added while it held the item at the close", async () => {
    const id = await draft("Held at the close");
    await document(id, "shared.pdf");
    await submit(id);
    await sendBackToDraft(id);
    await document(id, "holder-only.pdf");
    // Rabaed's cancel when a Company leaves the Project (workflow-engine.md §9; its command isn't built yet).
    await migrator.query("update work_item set outcome = 'cancelled', closed_at = now() where id = $1", [id]);
    expect(await recordDocuments(id)).toEqual(["shared.pdf"]);
  });

  it("holds a Revision's copies once the Revision was Submitted and closed", async () => {
    const id = await draft("Revised");
    await document(id, "revised.pdf");
    await submit(id);
    await code(id, "revise_c");
    const [revision] = await call<{ outcome: string; work_item_id: string }>(
      c1.member,
      sql`select outcome, work_item_id from app.create_revision(${id}::uuid, ${randomUUID()}::uuid, now())`,
    );
    expect(revision!.outcome).toBe("created");
    // The api copies the file and confirms the copy, as it does after create_revision.
    await migrator.query("update document set confirmed_at = coalesce(confirmed_at, now()) where work_item_id = $1", [revision!.work_item_id]);
    await submit(revision!.work_item_id);
    await code(revision!.work_item_id, "approve_a");
    expect(await recordDocuments(revision!.work_item_id)).toEqual(["revised.pdf"]);
  });

  it("answers nothing for an item still open", async () => {
    const id = await draft("Open");
    await document(id, "open.pdf");
    await submit(id);
    expect(await recordDocuments(id)).toEqual([]);
  });

  it("is not the app role's to call", async () => {
    await expect(call(c1.member, sql`select * from app.documents_shared_before_close(${randomUUID()}::uuid)`)).rejects.toThrow(/permission denied/);
  });
});
