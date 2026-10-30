// Seam 2 for the Company's logo and Stamp (RP-617, spec RP-632; ADR 0023; visibility.md scenario
// RP-617-1, the Company logo and Stamp row): `company.logo_file_id`
// and `company.stamp_file_id`, and the stored_file rows they point at, as the app role. Every
// Member of the Company reads them; another Company's Member reads neither the row nor its files.
// Only the Company's Authorized Person saves them, through app.set_company_image; the app role
// writes neither directly. A new upload is a new file: the one it replaces stays as it was. The
// test database gives every Company a Stamp (test-defaults.ts); these Companies start without one.
import { createHash, randomInt, randomUUID } from "node:crypto";
import { sql, type RawBuilder } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { expectHiddenFrom, testDatabaseUrls, withoutStamp } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;

let migrator: pg.Client;
let app: Db;
const asOwner = (text: string, values: unknown[]) => migrator.query(text, values);
const people = { ap: "", colleague: "", other: "", third: "" };
const companies = { a: "", b: "", c: "" };

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

const rowsAs = <T = Record<string, unknown>>(memberId: string | null, query: RawBuilder<unknown>) =>
  memberId === null
    ? query.execute(app).then((r) => r.rows as T[])
    : withMember(app, memberId, (trx) => query.execute(trx)).then((r) => r.rows as T[]);

/** A Company with no Stamp, its Authorized Person and `others` more Members. Returns [company, ap, ...others]. */
async function company(engineer: string, name: string, others: number): Promise<string[]> {
  const companyId = await one(
    "insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id",
    [JSON.stringify({ en: name, ar: name }), digits(10), `3${digits(13)}3`, engineer],
  );
  await withoutStamp(asOwner, companyId);
  const members: string[] = [];
  for (let i = 0; i <= others; i++) {
    members.push(
      await one("insert into member (company_id, email, full_name, status) values ($1, $2, $3, 'active') returning id", [
        companyId,
        email(`m${i}`),
        JSON.stringify({ en: `M${i}`, ar: `M${i}` }),
      ]),
    );
  }
  await migrator.query("update company set authorized_person_id = $2 where id = $1", [companyId, members[0]]);
  return [companyId, ...members];
}

/** Saves the Company's logo or Stamp as `memberId`, as the api does once it stored the image under its key. */
const save = (memberId: string | null, companyId: string, kind: string, mime = "image/png", key = `companies/${companyId}/${kind}/${randomUUID()}.png`) => {
  const sha = createHash("sha256").update(key).digest();
  return rowsAs<{ outcome: string }>(
    memberId,
    sql`select app.set_company_image(${companyId}::uuid, ${kind}, ${key}, ${sha}, ${2048}, ${mime}, now()) as outcome`,
  ).then((r) => r[0]!.outcome);
};

/** The Company's logo and Stamp files, as the owner reads them. */
const filesOf = async (companyId: string) =>
  (await migrator.query("select logo_file_id as logo, stamp_file_id as stamp from company where id = $1", [companyId])).rows[0] as {
    logo: string | null;
    stamp: string | null;
  };

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  const [a, ap, colleague] = await company(engineer, "Company A", 1);
  const [b, other] = await company(engineer, "Company B", 0);
  const [c, third] = await company(engineer, "Company C", 0);
  Object.assign(companies, { a: a!, b: b!, c: c! });
  Object.assign(people, { ap: ap!, colleague: colleague!, other: other!, third: third! });
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-617-1: app.set_company_image", () => {
  it("saves the Stamp and the logo for the Company's Authorized Person", async () => {
    expect(await save(people.ap, companies.a, "stamp")).toBe("set");
    expect(await save(people.ap, companies.a, "logo")).toBe("set");
    const files = await filesOf(companies.a);
    expect(files.stamp).toEqual(expect.any(String));
    expect(files.logo).toEqual(expect.any(String));
    expect(files.logo).not.toBe(files.stamp);
  });

  it("refuses another Member of the Company forbidden, and changes nothing", async () => {
    const before = await filesOf(companies.a);
    expect(await save(people.colleague, companies.a, "stamp")).toBe("forbidden");
    expect(await filesOf(companies.a)).toEqual(before);
  });

  it("is not_found for another Company's Member, even its Authorized Person, and with no acting Member", async () => {
    const before = await filesOf(companies.a);
    expect(await save(people.other, companies.a, "stamp")).toBe("not_found");
    expect(await save(null, companies.a, "stamp")).toBe("not_found");
    expect(await save(people.ap, randomUUID(), "stamp")).toBe("not_found");
    expect(await filesOf(companies.a)).toEqual(before);
  });

  it("takes only a PNG or JPEG image, as a logo or a Stamp", async () => {
    await expect(save(people.ap, companies.a, "stamp", "image/svg+xml")).rejects.toThrow();
    await expect(save(people.ap, companies.a, "seal")).rejects.toThrow();
    expect(await save(people.ap, companies.a, "stamp", "image/jpeg")).toBe("set");
  });

  it("replacing the Stamp points at a new file and keeps the old one as it was", async () => {
    const before = (await filesOf(companies.a)).stamp!;
    const kept = (await migrator.query("select storage_key, sha256 from stored_file where id = $1", [before])).rows[0];
    expect(await save(people.ap, companies.a, "stamp")).toBe("set");
    const after = (await filesOf(companies.a)).stamp!;
    expect(after).not.toBe(before);
    expect((await migrator.query("select storage_key, sha256 from stored_file where id = $1", [before])).rows[0]).toEqual(kept);
  });

  it("refuses an image stored anywhere but under the Company's own folder for that kind, and changes nothing", async () => {
    const before = await filesOf(companies.a);
    for (const [kind, key] of [
      ["stamp", `companies/${companies.b}/stamp/${randomUUID()}.png`],
      ["stamp", `companies/${companies.a}/logo/${randomUUID()}.png`],
      ["logo", `companies/${companies.a}/stamp/${randomUUID()}.png`],
      ["stamp", `companies/${companies.a}/stamp`],
      ["stamp", `companies/${companies.a}/stamps/${randomUUID()}.png`],
      ["stamp", `companies/${companies.a}/stamp/../../${companies.b}/stamp/${randomUUID()}.png`],
      ["stamp", `members/${people.ap}/signatures/${randomUUID()}.png`],
      ["stamp", `x/companies/${companies.a}/stamp/${randomUUID()}.png`],
    ] as const) {
      await expect(save(people.ap, companies.a, kind, "image/png", key), key).rejects.toThrow(/stored under the Company's own/);
    }
    expect(await filesOf(companies.a)).toEqual(before);
  });

  it("still answers another Company's Member not_found, whatever the key, so it reveals nothing", async () => {
    expect(await save(people.other, companies.a, "stamp", "image/png", `companies/${companies.b}/stamp/${randomUUID()}.png`)).toBe("not_found");
  });
});

describe("scenario RP-617-1: app.member_company_has_stamp, as the app role", () => {
  it("answers for the acting Member's own Company, and false for anyone else's", async () => {
    expect(await save(people.ap, companies.a, "stamp")).toBe("set");
    expect(await rowsAs(people.colleague, sql`select app.member_company_has_stamp(${people.colleague}::uuid) as has`)).toEqual([{ has: true }]);
    // Company A has a Stamp, but another Company's Member reads it as nobody's.
    expect(await rowsAs(people.other, sql`select app.member_company_has_stamp(${people.ap}::uuid) as has`)).toEqual([{ has: false }]);
    expect(await rowsAs(null, sql`select app.member_company_has_stamp(${people.ap}::uuid) as has`)).toEqual([{ has: false }]);
    expect(await rowsAs(people.other, sql`select app.member_company_has_stamp(${people.other}::uuid) as has`)).toEqual([{ has: false }]);
  });
});

/** `stored_file` rows among `fileIds` that a Member reads. */
const filesRead = (fileIds: string[]) => (reader: string) =>
  rowsAs<{ id: string }>(reader, sql`select id from stored_file where id = any(${fileIds}::uuid[])`);

/**
 * Company C's own Stamp, saved once by its Authorized Person: a file C's Member may read, so a read
 * of A's files as C is proven to work. Company C is these tests' own, so no other test's B changes.
 */
let cStampId: string | undefined;
async function cStamp(): Promise<string> {
  if (cStampId === undefined) {
    expect(await save(people.third, companies.c, "stamp")).toBe("set");
    cStampId = (await filesOf(companies.c)).stamp!;
  }
  return cStampId;
}

describe("scenario RP-617-1: company.logo_file_id and stamp_file_id", () => {
  it("are read by every Member of the Company, with the files they point at", async () => {
    const files = await filesOf(companies.a);
    for (const reader of [people.ap, people.colleague]) {
      expect(
        await rowsAs(reader, sql`select logo_file_id as logo, stamp_file_id as stamp from company where id = ${companies.a}::uuid`),
        reader,
      ).toEqual([files]);
      const read = await rowsAs<{ id: string }>(reader, sql`select id from stored_file where id in (${files.logo}::uuid, ${files.stamp}::uuid)`);
      expect(read.map((r) => r.id).sort(), reader).toEqual([files.logo, files.stamp].sort());
    }
  });

  it("are read by no other Company's Member: neither the row nor its files, current or replaced", async () => {
    await expectHiddenFrom({
      read: (reader: string) => rowsAs<{ id: string }>(reader, sql`select id from company where id = ${companies.a}::uuid`),
      target: companies.a,
      seenBy: [people.ap, people.colleague],
      hiddenFrom: people.other,
    });
    const { rows } = await migrator.query("select id from stored_file where storage_key like $1", [`companies/${companies.a}/%`]);
    const aFiles = rows.map((r) => r.id as string);
    const current = await filesOf(companies.a);
    expect(aFiles).toEqual(expect.arrayContaining([current.logo, current.stamp]));
    // One read names every file of A's (current and replaced) and C's own Stamp: B reads none, C exactly its own.
    const c = await cStamp();
    const readIds = filesRead([...aFiles, c]);
    for (const target of [current.logo!, current.stamp!]) {
      await expectHiddenFrom({ read: readIds, target, seenBy: [people.ap, people.colleague], hiddenFrom: [people.other, people.third] });
    }
    await expectHiddenFrom({ read: readIds, target: c, seenBy: people.third, hiddenFrom: people.other });
    expect((await readIds(people.third)).map((r) => r.id)).toEqual([c]);
  });

  it("a replaced file stays the Company's own: its Members no longer read it, nobody else ever did", async () => {
    const current = await filesOf(companies.a);
    const { rows } = await migrator.query("select id from stored_file where storage_key like $1 and not (id = any($2::uuid[]))", [
      `companies/${companies.a}/%`,
      [current.logo, current.stamp],
    ]);
    const replaced = rows.map((r) => r.id as string);
    expect(replaced.length).toBeGreaterThan(0);
    // Nobody may read a replaced file, so one read also names files each reader may: A's Members get
    // exactly A's current ones, C exactly its own Stamp, and neither gets a replaced one.
    const c = await cStamp();
    const readIds = filesRead([...replaced, current.logo!, current.stamp!, c]);
    const ids = async (reader: string) => (await readIds(reader)).map((r) => r.id).sort();
    for (const reader of [people.ap, people.colleague]) expect(await ids(reader), reader).toEqual([current.logo, current.stamp].sort());
    expect(await ids(people.third)).toEqual([c]);
    await expectHiddenFrom({ read: readIds, target: c, seenBy: people.third, hiddenFrom: [people.other, people.colleague] });
  });

  it("can't be written directly by the app role, even by the Authorized Person", async () => {
    const someFile = (await filesOf(companies.a)).stamp;
    for (const statement of [
      sql`update company set stamp_file_id = null where id = ${companies.a}::uuid`,
      sql`update company set logo_file_id = ${someFile}::uuid where id = ${companies.b}::uuid`,
    ]) {
      await expect(rowsAs(people.ap, statement)).rejects.toThrow(/permission denied/);
    }
  });
});

describe("the test database's defaults (test-defaults.ts)", () => {
  it("give a Company inserted by any route a Stamp and no logo, which a test of the gate takes away", async () => {
    const companyId = await one(
      // Onboarded by a Rabaed Engineer of its own (RP-995: no seed row is assumed).
      `with e as (insert into rabaed_engineer (email, full_name) values ($4, 'Defaults') returning id)
       insert into company (legal_name, cr_number, vat_number, onboarded_by) select $1, $2, $3, e.id from e returning id`,
      [JSON.stringify({ en: "Defaults", ar: "Defaults" }), digits(10), `3${digits(13)}3`, email("eng")],
    );
    const files = await filesOf(companyId);
    expect(files).toEqual({ logo: null, stamp: expect.any(String) });
    await withoutStamp(asOwner, companyId);
    expect(await filesOf(companyId)).toEqual({ logo: null, stamp: null });
  });
});
