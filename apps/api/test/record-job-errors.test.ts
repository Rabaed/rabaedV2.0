// Seam 1, the Members' side of scenario RP-670-1 (RP-1132; visibility.md, the Documental Record
// row; docs/visibility/scenarios/RP-670.md): a record job fails, then runs out of attempts. A Rabaed
// Engineer reads its error in Rabaed Admin; no Member does. C1's and K1's PMs read the item as
// "being prepared" while the job has attempts and with no record once it is dead, and none of their
// reads (the item, its history, the list, the bell) carries the error. A Member of a Company not on
// the Project gets the plain 404 for the item and its record, and no error in their bell.
//
// Every "nobody reads it" here is proven first by a reader who does: the error by the Engineer's
// list of record jobs, the item and its record by C1's and K1's PMs. The Engineer's side (the list,
// the retry, the log) is apps/admin/test/record-jobs.test.ts; the app role's, seam 2's
// packages/db/test/documental-record-checks-rls.test.ts. As there, the record job is made to fail
// with a handler that throws, and each run is held to the one job under test.
import { createHash, randomInt, randomUUID } from "node:crypto";
import { createDb, processOutbox, type OutboxHandler } from "@rabaed/db";
import { expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import type { SignedUrl } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestAdmin, type Browser } from "../../admin/test/support/harness.ts";
import { createTestApi, readById, type Caller } from "./support/harness.ts";
import { buildTower, detail, draft, memberOnProject, ok, take, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const admin = await createTestAdmin();
const urls = testDatabaseUrls();
// The worker (the app role, no Member), and the tables the seams don't show.
const worker = createDb(urls.app, { max: 1 });
const migrator = createDb(urls.migrator, { max: 1 });
afterAll(async () => {
  await admin.close();
  await api.close();
  await Promise.all([worker.destroy(), migrator.destroy()]);
});

const SLOW_MS = 120_000;
const REASON = "A customer asked why their record is late, RP-670-1";
/** The job's error: never shown to a Member. */
const ERROR = `the secret renderer failure ${randomUUID()}`;

let at: Tower;
let c1Engineer: Caller;
let c1Pm: Caller;
let k1Pm: Caller;
let outsider: Caller;
let engineer: { id: string; browser: Browser };
let item = "";
let outboxId = "";

beforeAll(async () => {
  const c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "RJE");
  const k1ParticipantId = (await at.admin!.get(`/v1/projects/${at.projectId}/participants`)).json().participants.find((p: { isOwnCompany: boolean }) => !p.isOwnCompany).id;
  c1Engineer = (await memberOnProject(api, c1, at.c1ParticipantId, ["engineer"])).caller;
  c1Pm = (await memberOnProject(api, c1, at.c1ParticipantId, ["project_manager"])).caller;
  k1Pm = (await memberOnProject(api, k1, k1ParticipantId, ["manager"])).caller;
  // A Member of a Company that is not on the Project.
  outsider = (await api.authorizedPerson()).caller;
  engineer = await admin.signedInEngineer();

  // A MAR the C1 engineer raises, the C1 PM Submits and K1's PM Approves: its record job is queued.
  item = await draft(at, c1Engineer, "Cable lugs, a record job that fails");
  await take(c1Engineer, item, "send_for_review");
  await ok(c1Pm.post(`/v1/work-items/${item}/pick-up`));
  await take(c1Pm, item, "submit");
  await ok(k1Pm.post(`/v1/work-items/${item}/pick-up`));
  await take(k1Pm, item, "approve_a");
  const { rows } = await sql<{ id: string }>`
    select id from outbox where kind = 'documental_record' and payload ->> 'closed_work_item_id' = ${item}
  `.execute(migrator);
  expect(rows).toHaveLength(1); // not hidden-from: the one record job the closure queued
  outboxId = rows[0]!.id;
}, SLOW_MS);

/** Runs the record job and nothing else (first in line, a run of one), failing with ERROR; two attempts in all. */
async function failOnce() {
  await sql`update outbox set available_at = '2000-01-01' where id = ${outboxId}::uuid`.execute(migrator);
  const fails: Record<string, OutboxHandler> = { documental_record: () => Promise.reject(new Error(ERROR)) };
  return processOutbox(worker, { handlers: fails, maxAttempts: 2, retryDelayMs: () => 0, limit: 1 });
}

/** One read whose body may carry the error: the Engineer's list of record jobs, or a Member's GET. */
type Read = { name: string; body: () => Promise<string> };
const engineerJobs: Read = {
  name: "the Engineer's record jobs",
  body: async () => (await engineer.browser.get(`/v1/record-jobs?reason=${encodeURIComponent(REASON)}`)).body,
};
const memberRead = (name: string, by: Caller, path: string): Read => ({ name, body: async () => (await ok(by.get(path), 200)).body });
const memberReads = (): Read[] => [
  memberRead("C1 PM, the item", c1Pm, `/v1/work-items/${item}`),
  memberRead("K1 PM, the item", k1Pm, `/v1/work-items/${item}`),
  memberRead("C1 PM, the item's history", c1Pm, `/v1/work-items/${item}/history`),
  memberRead("K1 PM, the item's history", k1Pm, `/v1/work-items/${item}/history`),
  memberRead("C1 PM, the list", c1Pm, `/v1/projects/${at.projectId}/work-items`),
  memberRead("C1 PM, the bell", c1Pm, "/v1/notifications"),
  memberRead("K1 PM, the bell", k1Pm, "/v1/notifications"),
  memberRead("another Company's Member, the bell", outsider, "/v1/notifications"),
];

/** The error is read by the Engineer, first, and by none of the Members' reads. */
const errorHiddenFromMembers = () =>
  expectHiddenFrom({
    read: async (r: Read) => ((await r.body()).includes(ERROR) ? [{ id: ERROR }] : []),
    target: ERROR,
    seenBy: engineerJobs,
    hiddenFrom: memberReads(),
    name: (r) => r.name,
  });

const who = (by: Caller) => (by === c1Pm ? "C1 PM" : by === k1Pm ? "K1 PM" : by === outsider ? "another Company's Member" : "someone");

describe("scenario RP-670-1: a record job that fails, as the Members read it", { timeout: SLOW_MS }, () => {
  it("is 'being prepared' while the job has attempts, and no Member reads its error", async () => {
    expect(await failOnce()).toMatchObject({ failed: 1, dead: 0 });
    for (const by of [c1Pm, k1Pm]) expect((await detail(by, item)).documentalRecord, who(by)).toBe("preparing");
    await errorHiddenFromMembers();
  });

  it("shows no record once the job is dead, and still no Member reads its error", async () => {
    expect(await failOnce()).toMatchObject({ dead: 1 });
    for (const by of [c1Pm, k1Pm]) expect((await detail(by, item)).documentalRecord, who(by)).toBeNull();
    await errorHiddenFromMembers();
  });

  it("is the plain 404 for a Member of a Company not on the Project: the item, and its record", async () => {
    await expectHiddenFrom({ read: readById(`/v1/work-items/${item}`), target: item, seenBy: [c1Pm, k1Pm], hiddenFrom: outsider, name: who });
    // A record written at last (as the worker would, after a retry): C1's and K1's PMs get its link, the outsider still the 404.
    await writeRecord();
    const recordOf = async (by: Caller) =>
      (await readById<SignedUrl>(`/v1/work-items/${item}/documental-record`)(by)).map((link) => ({ id: link.url.includes(`/work-items/${item}/`) ? item : link.url }));
    await expectHiddenFrom({ read: recordOf, target: item, seenBy: [c1Pm, k1Pm], hiddenFrom: outsider, name: who });
  });
});

/** Publishes a record for the item, as the worker saves one (the migrator stands in for it). */
async function writeRecord() {
  const sha = (s: string) => createHash("sha256").update(s).digest();
  // A Verification Code of its own (unique, four and four of Crockford's alphabet), so a second run makes another.
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const four = () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join("");
  const code = `${four()}-${four()}`;
  const key = `projects/${at.projectId}/work-items/${item}/documental-record/record.pdf`;
  const file = async (k: string, mime: string) =>
    (await sql<{ id: string }>`insert into stored_file (storage_key, sha256, size, mime) values (${k}, ${sha(k)}, 10, ${mime}) returning id`.execute(migrator)).rows[0]!.id;
  const pdf = await file(key, "application/pdf");
  const data = await file(key.replace("record.pdf", "record-data.xml"), "application/xml");
  await sql`insert into documental_record (project_id, work_item_id, pdf_file_id, record_data_file_id, layout_version, language, outcome,
      pdf_sha256, sealed_at, verification_token_hash, verification_code)
    values (${at.projectId}::uuid, ${item}::uuid, ${pdf}::uuid, ${data}::uuid, '1', 'bilingual', 'A', ${sha("pdf")}, now(), ${sha(randomUUID())}, ${code})`.execute(
    migrator,
  );
}
