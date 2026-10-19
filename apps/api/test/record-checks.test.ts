// Seam 1: the checks before a Documental Record is published, "record being prepared", the
// "record ready" notification and Re-produce (RP-155, spec RP-632; ADR 0023;
// workflow-engine.md §7; visibility.md V7, V14, the Documental Record and Notifications rows).
// The record job runs in-process as in documental-record.test.ts; the PDF/A-3 check is
// veraPDF itself (Docker image), and Rabaed Admin's side is its service as a Rabaed Engineer.
import { createHash } from "node:crypto";
import { listDocumentalRecordAlerts, reproduceDocumentalRecord } from "@rabaed/admin/services";
import { createDb, processOutbox, type OutboxHandler } from "@rabaed/db";
import { drainOutbox, testDatabaseUrls } from "@rabaed/db/test-support";
import type { NotificationList, SignedUrl } from "@rabaed/domain";
import {
  attachedFiles,
  chromiumRenderer,
  documentalRecordHandler,
  fallbackFonts,
  localSealSigner,
  localTimestampAuthority,
  projectFilesFromEnv,
  s3RecordFiles,
  reproduceHandler,
  verifySeal,
  veraPdfDockerSession,
  type PdfAValidator,
  type RecordJobDeps,
} from "@rabaed/worker/record";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { buildTower, detail, draft, memberOnProject, ok, bilingual, take, type Company, type Tower } from "./support/tower.ts";

// Each record is rendered by Chromium. veraPDF validates one representative record of each outcome (a closure, a
// Re-produce), in one container kept for the file; the other records are judged by the rest of the checks alone.
const SETUP_MS = 240_000;

const api = await createTestApi({ files: true });
const urls = testDatabaseUrls();
const worker = createDb(urls.app, { max: 2 });
const migrator = createDb(urls.migrator, { max: 1 });
const adminDb = createDb(urls.admin, { max: 1 });
const renderer = chromiumRenderer();
const files = s3RecordFiles(projectFilesFromEnv());
afterAll(async () => {
  await veraPdf.close();
  await renderer.close();
  await api.close();
  await Promise.all([worker.destroy(), migrator.destroy(), adminDb.destroy()]);
});

const REASON = "The PDF maker had a bug in the seal date, RP-155 test";
/** The real PDF/A-3 validator: veraPDF, in its Docker image. */
const veraPdf = veraPdfDockerSession();
/** Stands in for veraPDF where the other checks are what a test is about. */
const compliant: PdfAValidator = { validate: async () => ({ compliant: true, problems: [] }) };
const failing: PdfAValidator = { validate: async () => ({ compliant: false, problems: ["PDF/A-3 6.1.2: a test finding"]}) };

let at: Tower;
let k1: Company;
let k1ParticipantId = "";
let engineerId = "";
let c1Engineer: Caller;
let c1Pm: Caller;
let k1Pm: Caller;
let k1Engineer: Caller;
let orEngineer: Caller;
let c2Engineer: Caller;
let real: Record<string, OutboxHandler>;
let quick: Record<string, OutboxHandler>;

async function handlers(validator: PdfAValidator): Promise<Record<string, OutboxHandler>> {
  const signer = await localSealSigner();
  const timestamps = await localTimestampAuthority();
  const deps: RecordJobDeps = {
    files,
    renderer,
    signer: async () => signer,
    timestamps: async () => timestamps,
    fonts: async () => fallbackFonts(),
    webUrl: "https://rabaed.test",
    validator,
  };
  return { documental_record: documentalRecordHandler(deps), documental_record_reproduce: reproduceHandler(deps) };
}

const onboard = async (legalName: string): Promise<Company> => {
  const onboarded = await api.onboardCompany({ legalName: bilingual(legalName) });
  return { company: onboarded, caller: await api.acceptInvitation(onboarded.invitationToken) };
};

async function participant(company: Company, role: "contractor" | "owner_representative"): Promise<string> {
  const participantId = await api.addParticipant(at.admin!, at.projectId, company.company, role);
  await ok(at.admin!.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: { isAll: true, valueIds: [] }, location: { isAll: true, valueIds: [] } }));
  return participantId;
}

beforeAll(async () => {
  const c1 = await api.projectCreator();
  k1 = await onboard("Checks Consultants");
  at = await buildTower(api, { c1, k1 }, "RCK");
  const participants = (await at.admin!.get(`/v1/projects/${at.projectId}/participants`)).json().participants as { id: string; isOwnCompany: boolean }[];
  k1ParticipantId = participants.find((p) => !p.isOwnCompany)!.id;
  c1Engineer = (await memberOnProject(api, c1, at.c1ParticipantId, ["engineer"], { name: "Omar Haddad" })).caller;
  c1Pm = (await memberOnProject(api, c1, at.c1ParticipantId, ["project_manager"], { name: "Sara Qahtani" })).caller;
  k1Pm = (await memberOnProject(api, k1, k1ParticipantId, ["manager"], { name: "Huda Harbi" })).caller;
  k1Engineer = (await memberOnProject(api, k1, k1ParticipantId, ["engineer"], { name: "Faisal Otaibi" })).caller;
  const or = await onboard("Checks Owner Representative");
  orEngineer = (await memberOnProject(api, or, await participant(or, "owner_representative"), ["engineer"])).caller;
  const c2 = await onboard("Checks Second Contractor");
  c2Engineer = (await memberOnProject(api, c2, await participant(c2, "contractor"), ["engineer"])).caller;
  engineerId = await api.engineer();
  real = await handlers(veraPdf);
  quick = await handlers(compliant);
  // Anything earlier tests left in the outbox is not ours to judge, nor worth a veraPDF run each.
  await drainOutbox(worker, quick);
}, SETUP_MS);

/** A MAR the C1 engineer raises and sends, the C1 PM Submits, K1's PM Approves (Code A). */
async function closed(subject: string): Promise<string> {
  const id = await draft(at, c1Engineer, subject);
  await take(c1Engineer, id, "send_for_review");
  await ok(c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(c1Pm, id, "submit");
  await ok(k1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(k1Pm, id, "approve_a");
  return id;
}

const recordOf = (id: string) =>
  sql<{
    status: string;
    pdf_sha256: string;
    sealed_at: Date;
    token_hash: string;
    code: string;
  }>`
    select status, encode(pdf_sha256, 'hex') as pdf_sha256, sealed_at, encode(verification_token_hash, 'hex') as token_hash, verification_code as code
    from documental_record where work_item_id = ${id}
  `
    .execute(migrator)
    .then((r) => r.rows[0]);
const checksOf = (id: string) =>
  sql<{ run_kind: string; passed: boolean; problems: string[] }>`
    select c.run_kind, c.passed, c.problems from documental_record_check c join documental_record r on r.id = c.documental_record_id
    where r.work_item_id = ${id} order by c.ran_at, c.id
  `
    .execute(migrator)
    .then((r) => r.rows);
const bell = async (by: Caller, id: string) =>
  ((await ok(by.get("/v1/notifications"), 200)).json() as NotificationList).notifications.filter((n) => n.workItemId === id && n.kind === "record_ready");
const download = async (by: Caller, id: string): Promise<{ link: SignedUrl; bytes: Uint8Array }> => {
  const link = (await ok(by.get(`/v1/work-items/${id}/documental-record`), 200)).json() as SignedUrl;
  const res = await fetch(link.url);
  expect(res.status).toBe(200);
  return { link, bytes: new Uint8Array(await res.arrayBuffer()) };
};
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const location = (link: SignedUrl) => {
  const u = new URL(link.url);
  return u.origin + u.pathname;
};
const alertsFor = async (id: string) => (await listDocumentalRecordAlerts(adminDb, engineerId, "Checking the record alerts")).filter((a) => a.workItemId === id);

describe("a record that passes its checks", { timeout: SETUP_MS }, () => {
  let id = "";
  it("shows 'record being prepared' from the closure until its checks have passed, and nothing downloadable", async () => {
    await ok(k1Engineer.request("PUT", `/v1/projects/${at.projectId}/mute`));
    id = await closed("Cable trays for Building A");
    for (const by of [c1Pm, c1Engineer, k1Pm, orEngineer]) expect((await detail(by, id)).documentalRecord, "before the job").toBe("preparing");
    await expectHidden(c2Engineer.get(`/v1/work-items/${id}/documental-record`), "C2");
    await expectHidden(c1Pm.get(`/v1/work-items/${id}/documental-record`), "no record yet");
  });

  it("is published with the checks on record, and its download works", async () => {
    await drainOutbox(worker, real);
    expect(await recordOf(id)).toMatchObject({ status: "published" });
    expect(await checksOf(id)).toEqual([{ run_kind: "closure", passed: true, problems: [] }]);
    for (const by of [c1Pm, c1Engineer, k1Pm, orEngineer]) expect((await detail(by, id)).documentalRecord, "after").toBe("published");
    expect((await download(c1Pm, id)).bytes.length).toBeGreaterThan(1000);
    expect(await alertsFor(id)).toEqual([]);
  });

  it("tells every Member who sees the item that the record is ready, once, in the bell, with no Company or person named", async () => {
    for (const by of [c1Pm, c1Engineer, k1Pm, orEngineer]) {
      const got = await bell(by, id);
      expect(got, "a record ready notification").toHaveLength(1);
      expect(got[0]).toMatchObject({ kind: "record_ready", workItemId: id, step: null, event: null, readAt: null });
      expect(JSON.stringify(got[0])).not.toContain("Checks Consultants");
    }
    const routes = await sql<{ in_app: boolean; email: string }>`select in_app, email from notification where work_item_id = ${id} and kind = 'record_ready'`.execute(migrator);
    expect(routes.rows.every((r) => r.in_app && r.email === "none")).toBe(true);
    // Delivered once: another pass delivers nothing more.
    await drainOutbox(worker, quick);
    expect(await bell(c1Pm, id)).toHaveLength(1);
  });

  it("tells nobody who can't see the item, and nobody who muted the Project", async () => {
    expect(await bell(c2Engineer, id)).toEqual([]);
    expect(await bell(k1Engineer, id)).toEqual([]);
  });
});

describe("a record that fails its checks", { timeout: SETUP_MS }, () => {
  let id = "";
  it("publishes nothing: the item shows no record, nobody downloads one and nobody is told", async () => {
    const bad = await handlers(failing);
    id = await closed("Cable ladders");
    await drainOutbox(worker, bad);
    expect(await recordOf(id)).toMatchObject({ status: "failed_checks" });
    expect(await checksOf(id)).toEqual([{ run_kind: "closure", passed: false, problems: ["PDF/A-3 6.1.2: a test finding"] }]);
    for (const by of [c1Pm, k1Pm, orEngineer]) expect((await detail(by, id)).documentalRecord).toBeNull();
    await expectHidden(c1Pm.get(`/v1/work-items/${id}/documental-record`), "failed record");
    await expectHidden(k1Pm.get(`/v1/work-items/${id}/documental-record`), "failed record, K1");
    for (const by of [c1Pm, c1Engineer, k1Pm, orEngineer]) expect(await bell(by, id)).toEqual([]);
    // The closure and the job are untouched: the item is closed, the job is done, not retried.
    expect((await detail(c1Pm, id)).outcome).toBe("A");
    const jobs = await sql<{ attempts: number; processed_at: Date | null }>`
      select attempts, processed_at from outbox where kind = 'documental_record' and payload ->> 'closed_work_item_id' = ${id}
    `.execute(migrator);
    expect(jobs.rows).toHaveLength(1);
    expect(jobs.rows[0]!.processed_at).not.toBeNull();
  });

  it("raises an alert in Rabaed Admin, logged as a read with the Engineer's reason", async () => {
    const alerts = await alertsFor(id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ status: "failed_checks", problems: ["PDF/A-3 6.1.2: a test finding"] });
    expect(alerts[0]!.documentNumber).toBe((await detail(c1Pm, id)).documentNumber);
    const log = await sql<{ reason: string }>`
      select reason from admin_action where action = 'read_documental_record_alerts' and engineer_id = ${engineerId}::uuid
    `.execute(migrator);
    expect(log.rows.map((r) => r.reason)).toContain("Checking the record alerts");
  });

  it("is made good by a Re-produce that passes: published, the alert gone, everyone told", async () => {
    expect(await reproduceDocumentalRecord(adminDb, engineerId, id, REASON)).toBe("queued");
    await drainOutbox(worker, quick);
    expect(await recordOf(id)).toMatchObject({ status: "published" });
    expect((await checksOf(id)).map((c) => [c.run_kind, c.passed])).toEqual([
      ["closure", false],
      ["reproduce", true],
    ]);
    expect((await detail(c1Pm, id)).documentalRecord).toBe("published");
    expect((await download(k1Pm, id)).bytes.length).toBeGreaterThan(1000);
    expect(await alertsFor(id)).toEqual([]);
    for (const by of [c1Pm, k1Pm, orEngineer]) expect(await bell(by, id)).toHaveLength(1);
  });
});

describe("Re-produce in Rabaed Admin", { timeout: SETUP_MS }, () => {
  let id = "";
  let before: { bytes: Uint8Array; link: SignedUrl };
  let eventsBefore = "";
  const itemState = async () =>
    JSON.stringify(
      (
        await sql`
          select w.outcome, w.closed_at, w.current_step_id, (select count(*) from work_item_event e where e.work_item_id = w.id) as events,
            (select max(e.seq) from work_item_event e where e.work_item_id = w.id) as last_seq,
            app.work_item_chain_intact(w.id) as intact
          from work_item w where w.id = ${id}
        `.execute(migrator)
      ).rows,
    );

  it("remakes the PDF from the same Record Data at the same URL, with a new seal date, and keeps the replaced one", async () => {
    id = await closed("Cable glands");
    await drainOutbox(worker, quick);
    before = await download(c1Pm, id);
    const first = (await recordOf(id))!;
    const sealedBefore = (await verifySeal(before.bytes)).timestampedAt!;
    eventsBefore = await itemState();

    expect(await reproduceDocumentalRecord(adminDb, engineerId, id, REASON)).toBe("queued");
    expect(await reproduceDocumentalRecord(adminDb, engineerId, id, REASON), "while one waits").toBe("already_queued");
    await drainOutbox(worker, real);

    const after = await download(c1Pm, id);
    expect(location(after.link), "the same location, name and URL").toBe(location(before.link));
    expect(sha(after.bytes)).not.toBe(sha(before.bytes));
    const next = (await recordOf(id))!;
    expect(next.status).toBe("published");
    expect(next.pdf_sha256).toBe(sha(after.bytes));
    expect(next.sealed_at.getTime()).toBeGreaterThan(first.sealed_at.getTime());
    const seal = await verifySeal(after.bytes);
    expect(seal.valid).toBe(true);
    expect(seal.timestampedAt!.getTime()).toBeGreaterThanOrEqual(sealedBefore.getTime());
    // The verification token and code are kept, and the Record Data inside is the same file.
    expect([next.token_hash, next.code]).toEqual([first.token_hash, first.code]);
    const dataBefore = new TextDecoder().decode((await attachedFiles(before.bytes))[0]!.bytes);
    expect(new TextDecoder().decode((await attachedFiles(after.bytes))[0]!.bytes)).toBe(dataBefore);
    expect(dataBefore).toContain(first.code);
    expect((await checksOf(id)).map((c) => [c.run_kind, c.passed])).toEqual([
      ["closure", true],
      ["reproduce", true],
    ]);
  });

  it("keeps the replaced PDF and its fingerprint, and the Engineer's reason", async () => {
    const { rows } = await sql<{
      replaced_storage_key: string;
      replaced_sha256: string;
      replaced_size: string;
      new_sha256: string;
      previous_status: string;
      action: string;
      reason: string;
      target_id: string;
      engineer_id: string;
    }>`
      select x.replaced_storage_key, encode(x.replaced_sha256, 'hex') as replaced_sha256, x.replaced_size, encode(x.new_sha256, 'hex') as new_sha256,
        x.previous_status, a.action, a.reason, a.target_id, a.engineer_id
      from documental_record_reproduction x
      join documental_record r on r.id = x.documental_record_id
      join admin_action a on a.id = x.admin_action_id
      where r.work_item_id = ${id}
    `.execute(migrator);
    expect(rows).toHaveLength(1);
    const kept = rows[0]!;
    expect(kept).toMatchObject({ previous_status: "published", action: "reproduce_documental_record", reason: REASON, target_id: id, engineer_id: engineerId });
    expect(kept.replaced_sha256).toBe(sha(before.bytes));
    expect(kept.new_sha256).not.toBe(kept.replaced_sha256);
    const stored = await files.get(kept.replaced_storage_key);
    expect(stored && sha(stored)).toBe(kept.replaced_sha256);
    expect(Number(kept.replaced_size)).toBe(before.bytes.length);
  });

  it("never reopens the item or touches its Transitions", async () => {
    expect(await itemState()).toBe(eventsBefore);
    expect((await detail(c1Pm, id)).outcome).toBe("A");
  });

  it("is refused for an item with no record, and queues one job at a time", async () => {
    const open = await draft(at, c1Engineer, "Still a Draft");
    expect(await reproduceDocumentalRecord(adminDb, engineerId, open, REASON)).toBe("not_found");
    expect(await reproduceDocumentalRecord(adminDb, engineerId, "0198f5c0-0000-7000-8000-000000000000", REASON)).toBe("not_found");
    await expect(reproduceDocumentalRecord(adminDb, engineerId, id, "   ")).rejects.toThrow(/reason/);
    expect(await reproduceDocumentalRecord(adminDb, engineerId, id, REASON)).toBe("queued");
    await drainOutbox(worker, quick);
    expect(await reproduceDocumentalRecord(adminDb, engineerId, id, REASON), "after it was done").toBe("queued");
    await drainOutbox(worker, quick);
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from documental_record_reproduction x join documental_record r on r.id = x.documental_record_id where r.work_item_id = ${id}
    `.execute(migrator);
    expect(rows[0]!.n).toBe(3);
  });

  it("replaces nothing when the new PDF fails its checks: the published record stays, and Rabaed Admin is alerted", async () => {
    const id2 = await closed("Cable lugs");
    await drainOutbox(worker, quick);
    const published = await download(c1Pm, id2);
    const shaBefore = (await recordOf(id2))!.pdf_sha256;
    expect(await reproduceDocumentalRecord(adminDb, engineerId, id2, REASON)).toBe("queued");
    await drainOutbox(worker, await handlers(failing));
    const record = (await recordOf(id2))!;
    expect(record.status).toBe("published");
    expect(record.pdf_sha256).toBe(shaBefore);
    expect(sha((await download(c1Pm, id2)).bytes)).toBe(sha(published.bytes));
    const alerts = await alertsFor(id2);
    expect(alerts).toEqual([expect.objectContaining({ status: "published", problems: ["PDF/A-3 6.1.2: a test finding"] })]);
    // The next good Re-produce clears the alert.
    expect(await reproduceDocumentalRecord(adminDb, engineerId, id2, REASON)).toBe("queued");
    await drainOutbox(worker, quick);
    expect(await alertsFor(id2)).toEqual([]);
  });

  it("raises an alert for a record job that gave up", async () => {
    const id3 = await closed("Cable clips");
    const broken: PdfAValidator = { validate: () => Promise.reject(new Error("docker is not running")) };
    const run = await processOutbox(worker, { handlers: await handlers(broken), maxAttempts: 1, limit: 50 });
    expect(run.dead).toBeGreaterThanOrEqual(1);
    const alerts = await alertsFor(id3);
    expect(alerts).toEqual([expect.objectContaining({ status: "job_failed", problems: ["docker is not running"] })]);
    // The item still shows no record, not "being prepared" forever.
    expect((await detail(c1Pm, id3)).documentalRecord).toBeNull();
  });
});
