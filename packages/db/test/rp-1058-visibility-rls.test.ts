// Seam 2 for scenario RP-1058-1 (password reset): the visitor goes through the app role with no
// Member set, as the api does. A request answers the same for a C1 engineer's email, an email nobody
// has and a Member still invited, and the same past the limit; only the C1 engineer gets a reset,
// whose token is stored only as its hash; using it signs every other session of theirs out, and a
// second use does nothing. No table of it is read through the app role. Seam 1 is
// apps/api/test/password-reset.test.ts.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { digits, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest();
const PER_EMAIL = 3;
const PER_VISITOR = 50;

let migrator: pg.Client;
let app: Db;
let companyId = "";

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

/** A C1 Member with `status` and a fresh email. */
async function member(status: "active" | "invited"): Promise<{ id: string; email: string }> {
  const address = email(status === "active" ? "c1-engineer" : "c1-invited");
  const id = await one("insert into member (company_id, email, full_name, status) values ($1, $2, $3, $4) returning id", [
    companyId,
    address,
    JSON.stringify({ en: "C1 Engineer", ar: "C1 Engineer" }),
    status,
  ]);
  return { id, email: address };
}

/** The visitor asks for a link for `address`, through the app role with no Member set. */
const ask = async (address: string, visitor: Buffer): Promise<string> =>
  (
    await sql<{ outcome: string }>`
      select app.request_password_reset(${address}, ${visitor}, now(), ${PER_EMAIL}::int, ${PER_VISITOR}::int, interval '15 minutes') as outcome
    `.execute(app)
  ).rows[0]!.outcome;

/** The reset rows of `members`, as the database holds them. */
const resetsOf = async (members: string[]) =>
  (await migrator.query("select id, member_id, token_hash from password_reset where member_id = any($1::uuid[]) order by requested_at, id", [members])).rows as {
    id: string;
    member_id: string;
    token_hash: Buffer | null;
  }[];

/** A session of `memberId`: its id. */
const session = (memberId: string) =>
  one("insert into session (token_hash, member_id, expires_at) values ($1, $2, now() + interval '1 day') returning id", [sha256(randomBytes(32)), memberId]);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  companyId = await one("insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id", [
    JSON.stringify({ en: "C1", ar: "C1" }),
    digits(10),
    `3${digits(13)}3`,
    engineer,
  ]);
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-1058-1: a visitor asks for a password reset link for a C1 engineer, an email nobody has and a Member still invited", () => {
  it("answers the same for all three, and makes a reset for the C1 engineer only, its outbox row naming only the reset", async () => {
    const engineer = await member("active");
    const invited = await member("invited");
    const visitor = sha256(randomUUID());
    for (const address of [engineer.email, email("nobody"), invited.email]) expect(await ask(address, visitor), address).toBe("requested");

    const resets = await resetsOf([engineer.id, invited.id]);
    expect(resets.map((r) => r.member_id)).toEqual([engineer.id]);
    const { rows } = await migrator.query("select payload from outbox where kind = 'password_reset' and payload->>'passwordResetId' = $1", [resets[0]!.id]);
    expect(rows).toEqual([{ payload: { passwordResetId: resets[0]!.id } }]);
  });

  it("answers the same past the limit for one email, registered or not", async () => {
    const engineer = await member("active");
    for (const address of [engineer.email, email("nobody")]) {
      const answers = [];
      for (let i = 0; i <= PER_EMAIL; i++) answers.push(await ask(address, sha256(randomUUID())));
      expect(answers, address).toEqual([...Array<string>(PER_EMAIL).fill("requested"), "too_many_attempts"]);
    }
  });

  it("emails only the C1 engineer, stores the token only as its hash, and the link signs every other session out once", async () => {
    const engineer = await member("active");
    const colleague = await member("active");
    await ask(engineer.email, sha256(randomUUID()));
    const [reset] = await resetsOf([engineer.id]);
    // The worker, as the app role with no Member set, mints the token as it sends the email.
    const token = randomBytes(32).toString("base64url");
    const issued = await sql<{ to_address: string }>`
      select to_address from app.issue_password_reset(${reset!.id}::uuid, ${sha256(token)}, now(), interval '30 minutes')
    `.execute(app);
    expect(issued.rows.map((r) => r.to_address)).toEqual([engineer.email]);
    expect((await resetsOf([engineer.id]))[0]!.token_hash).toEqual(sha256(token));
    const holding = await migrator.query("select count(*)::int as n from outbox where payload::text like '%' || $1 || '%'", [token]);
    expect(holding.rows[0].n).toBe(0);

    const sessions = [await session(engineer.id), await session(engineer.id)];
    const colleagueSession = await session(colleague.id);
    const reset1 = await sql<{ id: string | null }>`select app.reset_password(${sha256(token)}, 'new-hash', now()) as id`.execute(app);
    expect(reset1.rows[0]!.id).toBe(engineer.id);
    const revoked = await migrator.query("select id, revoked_at is not null as revoked from session where id = any($1::uuid[]) order by id", [[...sessions, colleagueSession]]);
    expect(Object.fromEntries(revoked.rows.map((r: { id: string; revoked: boolean }) => [r.id, r.revoked]))).toEqual({
      [sessions[0]!]: true,
      [sessions[1]!]: true,
      [colleagueSession]: false,
    });
    // The second use is the same plain "expired or already used".
    const reset2 = await sql<{ id: string | null }>`select app.reset_password(${sha256(token)}, 'another-hash', now()) as id`.execute(app);
    expect(reset2.rows[0]!.id).toBeNull();
    const events = await migrator.query("select member_id from member_security_event where member_id = any($1::uuid[])", [[engineer.id, colleague.id]]);
    expect(events.rows.map((r: { member_id: string }) => r.member_id)).toEqual([engineer.id]);
  });

  it("lets nobody read a reset, an attempt or a security event through the app role", async () => {
    for (const table of ["password_reset", "password_reset_attempt", "member_security_event"]) {
      await expect(sql`select * from ${sql.table(table)}`.execute(app), table).rejects.toThrow(/permission denied/);
    }
  });
});
