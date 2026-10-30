// Seam 2 for the Signature (RP-85, ADR 0023): a Member's Signature rows and their files, as the
// app role. A Member reads only their own Signature rows and the stored_file rows they point
// at, never a colleague's nor another Company's; the record job reads anyone's as the owner.
// Nobody writes them directly, app.set_member_signature saves the acting Member's own, and
// replacing it ends the old row, which stays as it was. The test database gives every Member a
// Signature (test-defaults.ts); these Members start without one.
import { createHash, randomInt, randomUUID } from "node:crypto";
import { sql, type RawBuilder } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { expectHiddenFrom, testDatabaseUrls, withoutSignature, withoutStamp } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;

let migrator: pg.Client;
let app: Db;
const people = { a: "", colleague: "", b: "" };

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

const rowsAs = <T = Record<string, unknown>>(memberId: string | null, query: RawBuilder<unknown>) =>
  memberId === null
    ? query.execute(app).then((r) => r.rows as T[])
    : withMember(app, memberId, (trx) => query.execute(trx)).then((r) => r.rows as T[]);

/** A Company and `count` of its Members, none with a Signature in force. */
async function company(engineer: string, name: string, count: number): Promise<string[]> {
  const companyId = await one(
    "insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id",
    [JSON.stringify({ en: name, ar: name }), digits(10), `3${digits(13)}3`, engineer],
  );
  // No Stamp (RP-617), so the only files its Members read are their Signatures'.
  await withoutStamp((text, values) => migrator.query(text, values), companyId);
  const members: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = await one("insert into member (company_id, email, full_name, status) values ($1, $2, $3, 'active') returning id", [
      companyId,
      email(`m${i}`),
      JSON.stringify({ en: `M${i}`, ar: `M${i}` }),
    ]);
    await withoutSignature((text, values) => migrator.query(text, values), id);
    members.push(id);
  }
  return members;
}

/** Saves a Signature as `memberId`, as the api does once it stored the image under its key. */
const save = (memberId: string | null, method = "drawn", mime = "image/png", key = `members/${memberId}/signatures/${randomUUID()}.png`) => {
  const sha = createHash("sha256").update(key).digest();
  return rowsAs<{ id: string | null }>(
    memberId,
    sql`select app.set_member_signature(${key}, ${sha}, ${1234}, ${mime}, ${method}, now()) as id`,
  ).then((r) => r[0]!.id);
};

/** The Signature rows `reader` reads, by whose they are. */
const ownersRead = async (reader: string) =>
  [...new Set((await rowsAs<{ member_id: string }>(reader, sql`select member_id from member_signature`)).map((r) => r.member_id))];

/** The stored_file rows `reader` reads, by who uploaded them (read as the owner). */
async function fileUploadersRead(reader: string): Promise<string[]> {
  const ids = (await rowsAs<{ id: string }>(reader, sql`select id from stored_file`)).map((r) => r.id);
  const { rows } = await migrator.query("select distinct uploaded_by_member_id as who from stored_file where id = any($1::uuid[])", [ids]);
  return rows.map((r) => r.who as string);
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  const [a, colleague] = await company(engineer, "Company A", 2);
  const [other] = await company(engineer, "Company B", 1);
  Object.assign(people, { a: a!, colleague: colleague!, b: other! });
  expect(await save(people.a, "typed")).toBeTruthy();
  expect(await save(people.b, "uploaded", "image/jpeg")).toBeTruthy();
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("member_signature", () => {
  it("is read by its own Member, with the file it points at", async () => {
    const own = await rowsAs<{ member_id: string; method: string; file_id: string }>(
      people.a,
      sql`select member_id, method, file_id from member_signature where active_to is null`,
    );
    expect(own).toEqual([{ member_id: people.a, method: "typed", file_id: expect.any(String) }]);
    expect(await rowsAs(people.a, sql`select mime, size from stored_file where id = ${own[0]!.file_id}::uuid`)).toEqual([
      { mime: "image/png", size: "1234" },
    ]);
  });

  it("is read by nobody else: not a colleague of the same Company, nor another Company's Member", async () => {
    for (const reader of [people.a, people.colleague, people.b]) {
      expect(await ownersRead(reader), reader).toEqual([reader]);
      expect(await fileUploadersRead(reader), reader).toEqual([reader]);
    }
    // And by id: each Signature in force, and its file, is read by its own Member and nobody else.
    for (const [owner, others] of [
      [people.a, [people.colleague, people.b]],
      [people.b, [people.a, people.colleague]],
    ] as const) {
      const { rows } = await migrator.query("select id, file_id from member_signature where member_id = $1 and active_to is null", [owner]);
      const { id, file_id } = rows[0] as { id: string; file_id: string };
      const name = (reader: string) => Object.entries(people).find(([, v]) => v === reader)![0];
      await expectHiddenFrom({ read: (r: string) => rowsAs<{ id: string }>(r, sql`select id from member_signature`), target: id, seenBy: owner, hiddenFrom: others, name });
      await expectHiddenFrom({ read: (r: string) => rowsAs<{ id: string }>(r, sql`select id from stored_file`), target: file_id, seenBy: owner, hiddenFrom: others, name });
    }
  });

  it("is read by the owner, as the record job reads it: everyone's", async () => {
    const { rows } = await migrator.query("select distinct member_id from member_signature where member_id = any($1::uuid[])", [
      [people.a, people.b],
    ]);
    expect(rows.map((r) => r.member_id).sort()).toEqual([people.a, people.b].sort());
  });

  it("never gives the app role a file's fingerprint or uploader", async () => {
    await expect(rowsAs(people.a, sql`select sha256 from stored_file`)).rejects.toThrow(/permission denied/);
    await expect(rowsAs(people.a, sql`select uploaded_by_member_id from stored_file`)).rejects.toThrow(/permission denied/);
  });

  it("can't be written directly by the app role", async () => {
    for (const statement of [
      sql`insert into member_signature (member_id, file_id, method, active_from) select ${people.a}::uuid, id, 'drawn', now() from stored_file`,
      sql`update member_signature set method = 'uploaded'`,
      sql`delete from member_signature`,
      sql`insert into stored_file (storage_key, sha256, size, mime) values ('k', '\\x00', 1, 'image/png')`,
    ]) {
      await expect(rowsAs(people.a, statement)).rejects.toThrow(/permission denied/);
    }
  });

  it("replacing it ends the old row, kept as it was, and makes the new one the only one in force", async () => {
    expect(await rowsAs(people.colleague, sql`select 1 from member_signature where active_to is null`)).toEqual([]); // not hidden-from: the colleague's own, before they save one
    const first = await save(people.colleague, "drawn");
    const second = await save(people.colleague, "uploaded");
    const rows = await rowsAs<{ id: string; method: string; ended: boolean }>(
      people.colleague,
      sql`select id, method, active_to is not null as ended from member_signature where id in (${first}::uuid, ${second}::uuid) order by active_from, id`,
    );
    expect(rows).toEqual([
      { id: first, method: "drawn", ended: true },
      { id: second, method: "uploaded", ended: false },
    ]);
  });

  it("is never changed once replaced, nor removed, even by the owner", async () => {
    await expect(migrator.query("update member_signature set method = 'typed' where member_id = $1", [people.colleague])).rejects.toThrow(
      /changes only when replaced/,
    );
    await expect(migrator.query("delete from member_signature where member_id = $1", [people.colleague])).rejects.toThrow(
      /changes only when replaced/,
    );
    await expect(migrator.query("delete from stored_file where uploaded_by_member_id = $1", [people.colleague])).rejects.toThrow(
      /immutable/,
    );
  });

  it("is saved as null with no acting Member, and takes only PNG or JPEG, made one of the three ways", async () => {
    expect(await save(null)).toBeNull();
    await expect(save(people.a, "drawn", "image/svg+xml")).rejects.toThrow();
    await expect(save(people.a, "scanned")).rejects.toThrow();
    expect(await rowsAs(people.a, sql`select method from member_signature where active_to is null`)).toEqual([{ method: "typed" }]);
  });

  it("refuses an image stored anywhere but under the acting Member's own Signatures, and saves nothing", async () => {
    const before = await rowsAs(people.a, sql`select id from member_signature where active_to is null`);
    for (const key of [
      `members/${people.b}/signatures/${randomUUID()}.png`,
      `members/${people.colleague}/signatures/${randomUUID()}.png`,
      `members/${people.a}/signatures`,
      `members/${people.a}/signatures-old/${randomUUID()}.png`,
      `members/${people.a}/stamp/${randomUUID()}.png`,
      `members/${people.a}/signatures/../../${people.b}/signatures/${randomUUID()}.png`,
      `companies/${people.a}/stamp/${randomUUID()}.png`,
      `x/members/${people.a}/signatures/${randomUUID()}.png`,
    ]) {
      await expect(save(people.a, "drawn", "image/png", key), key).rejects.toThrow(/stored under the Member's own Signatures/);
    }
    expect(await rowsAs(people.a, sql`select id from member_signature where active_to is null`)).toEqual(before);
  });
});

describe("app.active_signature_id, as the app role", () => {
  it("gives the acting Member their own Signature in force, and nobody else's", async () => {
    const own = await rowsAs<{ id: string }>(people.a, sql`select id from member_signature where active_to is null`);
    expect(await rowsAs(people.a, sql`select app.active_signature_id(${people.a}::uuid) as id`)).toEqual(own);
    // people.b has one in force, which they read as theirs, but anyone else reads it as nobody's.
    const { rows } = await migrator.query("select id from member_signature where member_id = $1 and active_to is null", [people.b]);
    await expectHiddenFrom({
      read: async (reader: string | null) =>
        (await rowsAs<{ id: string | null }>(reader, sql`select app.active_signature_id(${people.b}::uuid) as id`)).filter((r) => r.id !== null),
      target: rows[0].id as string,
      idOf: (r) => r.id!,
      seenBy: people.b,
      hiddenFrom: [people.a, null],
      name: (reader) => (reader === null ? "no Member" : reader === people.a ? "A" : "B"),
    });
  });
});

describe("the test database's defaults (test-defaults.ts)", () => {
  it("give a Member inserted by any route a Signature in force, which a test of the gate ends", async () => {
    const companyId = await one(
      // Onboarded by a Rabaed Engineer of its own (RP-995: no seed row is assumed).
      `with e as (insert into rabaed_engineer (email, full_name) values ($4, 'Defaults') returning id)
       insert into company (legal_name, cr_number, vat_number, onboarded_by) select $1, $2, $3, e.id from e returning id`,
      [JSON.stringify({ en: "Defaults", ar: "Defaults" }), digits(10), `3${digits(13)}3`, email("eng")],
    );
    const id = await one("insert into member (company_id, email, full_name, status) values ($1, $2, $3, 'active') returning id", [
      companyId,
      email("default"),
      JSON.stringify({ en: "D", ar: "D" }),
    ]);
    expect(await rowsAs(id, sql`select method from member_signature where active_to is null`)).toEqual([{ method: "drawn" }]);
    await withoutSignature((text, values) => migrator.query(text, values), id);
    expect(await rowsAs(id, sql`select 1 from member_signature where active_to is null`)).toEqual([]); // not hidden-from: the Member's own, once ended
  });
});
