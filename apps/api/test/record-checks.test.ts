// Seam 1: the checks before a Documental Record is published, "record being prepared", the
// "record ready" notification and Re-produce (RP-155, spec RP-632; ADR 0023;
// workflow-engine.md §7; visibility.md V7, V14, the Documental Record and Notifications rows;
// scenarios RP-155-1, RP-155-2, RP-155-3 and RP-950-1). The record job runs in-process as in
// documental-record.test.ts (the harness); what is asserted is read through the seams: the Members'
// bell and item read, the download, and Rabaed Admin's HTTP routes as a signed-in Rabaed Engineer.
// The PDF/A-3 check is veraPDF itself (Docker image). Where no seam shows a fact (the checks' history,
// the replaced PDFs, the record's fingerprint and seal date, the job's attempts), the test reads the
// table as the migrator, and says so.
import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import { createDb, dailyDigestJob, notificationDigestHandler, notificationEmailHandler, processOutbox, runScheduledJobs, type OutboxHandler } from "@rabaed/db";
import { drainOutbox, testDatabaseUrls } from "@rabaed/db/test-support";
import type { NotificationDigest, NotificationList, NotificationSettingsView, SignedUrl } from "@rabaed/domain";
import { mailerFromEnv, notificationDigestMessage, notificationMessage, renderEmail } from "@rabaed/mailer";
import {
  attachedFiles,
  chromiumRenderer,
  documentalRecordHandler,
  fallbackFonts,
  imageCountOf,
  localSealSigner,
  localTimestampAuthority,
  PINNED_VERAPDF_IMAGE,
  projectFilesFromEnv,
  reproduceHandler,
  s3RecordFiles,
  veraPdfDockerSession,
  verifySeal,
  type PdfAValidator,
  type RecordJobDeps,
} from "@rabaed/worker/record";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestAdmin } from "../../admin/test/support/harness.ts";
import { createTestApi, expectHidden, uploadDocument, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { bilingual, buildTower, detail, draft, memberOnProject, ok, take, type Company, type Tower } from "./support/tower.ts";

// Each record is rendered by Chromium. veraPDF validates one representative record of each outcome (a closure, a
// Re-produce), in one container kept for the file; the other records are judged by the rest of the checks alone.
const SETUP_MS = 240_000;

const api = await createTestApi({ files: true });
const admin = await createTestAdmin();
const urls = testDatabaseUrls();
const worker = createDb(urls.app, { max: 2 });
const migrator = createDb(urls.migrator, { max: 1 });
const renderer = chromiumRenderer();
const files = s3RecordFiles(projectFilesFromEnv());
afterAll(async () => {
  await veraPdf.close();
  await renderer.close();
  await admin.close();
  await api.close();
  await Promise.all([worker.destroy(), migrator.destroy()]);
});

const REASON = "The PDF maker had a bug in the seal date, RP-155 test";
/** The real PDF/A-3 validator: veraPDF, in its Docker image. */
const veraPdf = veraPdfDockerSession(PINNED_VERAPDF_IMAGE);
/** Stands in for veraPDF where the other checks are what a test is about. */
const compliant: PdfAValidator = { validate: async () => ({ compliant: true, problems: [] }) };
const failing: PdfAValidator = { validate: async () => ({ compliant: false, problems: ["PDF/A-3 6.1.2: a test finding"] }) };

const PHOTO_TYPE = "RCKPH";
const photoSchema = {
  sections: [
    {
      key: "material",
      title: bilingual("Material"),
      fields: [
        { key: "model", type: "text", label: bilingual("Model") },
        { key: "site_photos", type: "photos", label: bilingual("Site photos") },
      ],
    },
    {
      key: "classification",
      title: bilingual("Classification"),
      fields: [
        { key: "trade", type: "trade", label: bilingual("Trade") },
        { key: "location", type: "location", label: bilingual("Location") },
        { key: "scopes", type: "scopes", label: bilingual("Scopes") },
      ],
    },
  ],
};

/** A valid PNG of one pixel in the colour (r, g, b): distinct bytes for distinct colours, and no EXIF, so no time to tell two photos apart by. */
function png(r: number, g: number, b: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from([0, r, g, b]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let at: Tower;
let k1: Company;
let k1ParticipantId = "";
let engineer: { id: string; browser: Awaited<ReturnType<typeof admin.signedInEngineer>>["browser"] };
let c1Engineer: Caller;
let c1Pm: Caller;
let k1Pm: Caller;
let k1Engineer: Caller;
let orEngineer: Caller;
let c2Engineer: Caller;
/** The Members' email addresses, for the Record ready emails (RP-950). */
const emails = {} as Record<"c1Engineer" | "c1Pm" | "k1Pm" | "orEngineer" | "c2Engineer", string>;
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
  await addSendBackType(migrator, PHOTO_TYPE, { en: "Record checks photos", ar: "صور فحص السجل" }, photoSchema);
  const c1 = await api.projectCreator();
  k1 = await onboard("Checks Consultants");
  at = await buildTower(api, { c1, k1 }, "RCK");
  const participants = (await at.admin!.get(`/v1/projects/${at.projectId}/participants`)).json().participants as { id: string; isOwnCompany: boolean }[];
  k1ParticipantId = participants.find((p) => !p.isOwnCompany)!.id;
  const c1EngineerMember = await memberOnProject(api, c1, at.c1ParticipantId, ["engineer"], { name: "Omar Haddad" });
  const c1PmMember = await memberOnProject(api, c1, at.c1ParticipantId, ["project_manager"], { name: "Sara Qahtani" });
  const k1PmMember = await memberOnProject(api, k1, k1ParticipantId, ["manager"], { name: "Huda Harbi" });
  c1Engineer = c1EngineerMember.caller;
  c1Pm = c1PmMember.caller;
  k1Pm = k1PmMember.caller;
  Object.assign(emails, { c1Engineer: c1EngineerMember.email, c1Pm: c1PmMember.email, k1Pm: k1PmMember.email });
  k1Engineer = (await memberOnProject(api, k1, k1ParticipantId, ["engineer"], { name: "Faisal Otaibi" })).caller;
  const or = await onboard("Checks Owner Representative");
  const orMember = await memberOnProject(api, or, await participant(or, "owner_representative"), ["engineer"]);
  orEngineer = orMember.caller;
  emails.orEngineer = orMember.email;
  const c2 = await onboard("Checks Second Contractor");
  const c2Member = await memberOnProject(api, c2, await participant(c2, "contractor"), ["engineer"]);
  c2Engineer = c2Member.caller;
  emails.c2Engineer = c2Member.email;
  engineer = await admin.signedInEngineer();
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

/** An item of the photos Type with one Form photo for each of `photos` (all named `fileName`), closed with Code A. */
async function closedWithPhotos(subject: string, fileName: string, photos: Buffer[]): Promise<string> {
  const res = await ok(
    c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, {
      type: PHOTO_TYPE,
      title: subject,
      answers: { model: "CT-100", trade: at.electrical, location: at.buildingA },
    }),
    201,
  );
  const id = res.json().id as string;
  for (const body of photos) await uploadDocument(c1Engineer, id, { fieldKey: "site_photos", fileName, contentType: "image/png", body });
  await take(c1Engineer, id, "send_for_review");
  await ok(c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(c1Pm, id, "submit");
  await ok(k1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(k1Pm, id, "send_to_manager");
  await ok(k1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(k1Pm, id, "approve_a");
  return id;
}

// The record's fingerprint, seal date and verification hash, and the checks' history, are read as the migrator:
// no seam shows them (the verification page is RP-157, the Admin screens RP-670).
const recordOf = (id: string) =>
  sql<{ pdf_sha256: string; sealed_at: Date; token_hash: string; code: string }>`
    select encode(pdf_sha256, 'hex') as pdf_sha256, sealed_at, encode(verification_token_hash, 'hex') as token_hash, verification_code as code
    from documental_record where work_item_id = ${id}
  `
    .execute(migrator)
    .then((r) => r.rows[0]!);
const checksOf = (id: string) =>
  sql<{ run_kind: string; passed: boolean }>`
    select c.run_kind, c.passed from documental_record_check c join documental_record r on r.id = c.documental_record_id
    where r.work_item_id = ${id} order by c.ran_at, c.id
  `
    .execute(migrator)
    .then((r) => r.rows.map((c) => [c.run_kind, c.passed]));

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

// Rabaed Admin, over HTTP as a signed-in Rabaed Engineer.
const reproduce = (id: string, reason: string = REASON) => engineer.browser.post(`/v1/work-items/${id}/documental-record/reproduce`, { reason });
const alertsFor = async (id: string) => {
  const res = await engineer.browser.get(`/v1/documental-record-alerts?reason=${encodeURIComponent("Checking the record alerts")}`);
  expect(res.statusCode, res.body).toBe(200);
  return (res.json().alerts as { workItemId: string; status: string; problems: string[]; documentNumber: string | null }[]).filter((a) => a.workItemId === id);
};

describe("scenarios RP-155-1 and RP-155-2: a record that passes its checks", { timeout: SETUP_MS }, () => {
  let id = "";
  it("shows 'record being prepared' from the closure until its checks have passed, and nothing downloadable (RP-155-2)", async () => {
    await ok(k1Engineer.request("PUT", `/v1/projects/${at.projectId}/mute`));
    id = await closed("Cable trays for Building A");
    for (const by of [c1Pm, c1Engineer, k1Pm, orEngineer]) expect((await detail(by, id)).documentalRecord, "before the job").toBe("preparing");
    await expectHidden(c2Engineer.get(`/v1/work-items/${id}/documental-record`), "C2");
    await expectHidden(c1Pm.get(`/v1/work-items/${id}/documental-record`), "no record yet");
  });

  it("is the same for C2 as for an item that does not exist: nothing, never 'being prepared' (RP-155-2)", async () => {
    await expectHidden(c2Engineer.get(`/v1/work-items/${id}`), "C2 reads the item itself");
    await expectHidden(c2Engineer.get("/v1/work-items/0198f5c0-0000-7000-8000-000000000000"), "made-up id");
  });

  it("is published, and its download works (RP-155-2)", async () => {
    await drainOutbox(worker, real);
    for (const by of [c1Pm, c1Engineer, k1Pm, orEngineer]) expect((await detail(by, id)).documentalRecord, "after").toBe("published");
    expect((await download(c1Pm, id)).bytes.length).toBeGreaterThan(1000);
    expect(await alertsFor(id)).toEqual([]);
    expect(await checksOf(id)).toEqual([["closure", true]]);
  });

  it("tells every Member who sees the item that the record is ready, once, in the bell, with no Company or person named (RP-155-1)", async () => {
    for (const by of [c1Pm, c1Engineer, k1Pm, orEngineer]) {
      const got = await bell(by, id);
      expect(got, "a record ready notification").toHaveLength(1);
      expect(got[0]).toMatchObject({ kind: "record_ready", workItemId: id, step: null, event: null, readAt: null });
      expect(JSON.stringify(got[0])).not.toContain("Checks Consultants");
    }
    // Routed by each Member's "Items I watch" email choice (RP-950), none of them changed here: the daily digest.
    // Read from the table: no read exposes a notification's email route.
    const routes = await sql<{ in_app: boolean; email: string }>`select in_app, email from notification where work_item_id = ${id} and kind = 'record_ready'`.execute(migrator);
    expect(routes.rows.length).toBeGreaterThanOrEqual(4);
    expect(routes.rows.filter((r) => !(r.in_app && r.email === "digest"))).toEqual([]);
    // Delivered once: another pass delivers nothing more.
    await drainOutbox(worker, quick);
    expect(await bell(c1Pm, id)).toHaveLength(1);
  });

  it("tells nobody who can't see the item, and nobody who muted the Project (RP-155-1)", async () => {
    expect(await bell(c2Engineer, id)).toEqual([]);
    expect(await bell(k1Engineer, id)).toEqual([]);
  });
});

// Record ready by email and in the daily digest (RP-950). The immediate emails go through the real mailer to Mailpit and
// are read back through its API; the digest is run as the worker runs it, and its email rendered as the worker sends it.
const WEB_URL = "https://rabaed.test";
const catcherUrl = process.env.MAIL_CATCHER_URL;
if (!catcherUrl) throw new Error("MAIL_CATCHER_URL is not set: start Mailpit (docker compose up -d mailpit) and see .env.example");
const mailer = mailerFromEnv({ ...process.env, MAIL_FROM: "no-reply@rabaed.test", MAIL_SES_CONFIGURATION_SET: undefined });
interface CaughtMessage {
  To: { Address: string }[];
  Subject: string;
  Text: string;
}
/** What Mailpit holds for `to`: waits a moment for a first message, so an empty answer means none came. */
async function caught(to: string): Promise<CaughtMessage[]> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const search = await fetch(new URL(`/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`, catcherUrl));
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    if (messages.length > 0) {
      return Promise.all(messages.map(async ({ ID }) => (await fetch(new URL(`/api/v1/message/${ID}`, catcherUrl))).json() as Promise<CaughtMessage>));
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return [];
}
const emailHandler = notificationEmailHandler(async (email) => mailer.send(notificationMessage(email, WEB_URL)));
const saveWatched = async (by: Caller, email: "off" | "immediate" | "digest", preferredLanguage?: "en" | "ar") => {
  const now: NotificationSettingsView = (await ok(by.get("/v1/notification-settings"), 200)).json();
  await ok(
    by.request("PUT", "/v1/notification-settings", {
      settings: { ...now.settings, watched: { ...now.settings.watched, email } },
      emailPaused: now.emailPaused,
      preferredLanguage: preferredLanguage ?? now.preferredLanguage,
    }),
  );
};

describe("scenario RP-950-1: record ready by email and in the digest", { timeout: SETUP_MS }, () => {
  let id = "";
  let documentNumber = "";
  const digests: NotificationDigest[] = [];
  const readyEmails = async (to: string) => (await caught(to)).filter((m) => m.Subject.includes("Record ready to download") || m.Subject.includes("السجل جاهز للتنزيل"));

  beforeAll(async () => {
    // "Items I watch" is the setting this notification follows: C1's PM and engineer want it at once (the engineer in Arabic),
    // K1's PM keeps the default (the daily digest), the Owner Representative's engineer turns the email off, and C2's can't see the item.
    await saveWatched(c1Pm, "immediate", "en");
    await saveWatched(c1Engineer, "immediate", "ar");
    await saveWatched(orEngineer, "off");
    await saveWatched(c2Engineer, "immediate");
    id = await closed("Chillers for Building A");
    documentNumber = (await detail(c1Pm, id)).documentNumber!;
    await drainOutbox(worker, { ...quick, email: emailHandler });
  }, SETUP_MS);

  it("emails a Member who sees the item and chose immediately, once, with a link to the item and never to the file", async () => {
    const got = await readyEmails(emails.c1Pm);
    expect(got).toHaveLength(1);
    expect(got[0]!.Subject).toContain(documentNumber);
    expect(got[0]!.Subject).toContain("Chillers for Building A");
    expect(got[0]!.Subject).toContain("Record ready to download");
    expect(got[0]!.Text).toContain(`https://rabaed.test/en/work-items/${id}`);
    expect(got[0]!.Text).not.toContain("documental-record");
  });

  it("names no Company and no person in it (V14)", async () => {
    for (const to of [emails.c1Pm, emails.c1Engineer]) {
      const [email] = await readyEmails(to);
      for (const text of [email!.Subject, email!.Text]) {
        for (const name of ["Checks Consultants", "Test Constructions", "إنشاءات الاختبار", "Checks Owner Representative", "Checks Second Contractor", "Omar Haddad", "Sara Qahtani", "Huda Harbi", "Faisal Otaibi"]) {
          expect(text, name).not.toContain(name);
        }
      }
    }
  });

  it("emails it in Arabic to a Member whose preferred language is Arabic", async () => {
    const got = await readyEmails(emails.c1Engineer);
    expect(got).toHaveLength(1);
    expect(got[0]!.Subject).toContain("السجل جاهز للتنزيل");
    expect(got[0]!.Text).toContain(`https://rabaed.test/ar/work-items/${id}`);
    expect(got[0]!.Text).not.toContain("documental-record");
  });

  it("emails no one at once who chose the digest or turned the email off, and nothing to a Member who can't see the item", async () => {
    expect(await readyEmails(emails.k1Pm)).toEqual([]);
    expect(await readyEmails(emails.orEngineer)).toEqual([]);
    expect((await caught(emails.c2Engineer)).filter((m) => m.Subject.includes(documentNumber))).toEqual([]);
    expect(await bell(c2Engineer, id)).toEqual([]);
    // The bell is unchanged by the email choice.
    for (const by of [c1Pm, c1Engineer, k1Pm, orEngineer]) expect(await bell(by, id)).toHaveLength(1);
  });

  it("lists it in the daily digest of a Member who kept the default, with a link to the item", async () => {
    await sql`delete from scheduled_job_run where job = ${dailyDigestJob.name}`.execute(migrator);
    // Monday 12 October 2026, 07:00 Riyadh.
    await runScheduledJobs(worker, [dailyDigestJob], new Date("2026-10-12T07:00:00+03:00"));
    await drainOutbox(worker, { ...quick, digest: notificationDigestHandler(async (digest) => void digests.push(digest)) });
    const entriesFor = (to: string) =>
      digests
        .filter((d) => d.to === to)
        .flatMap((d) => d.projects.flatMap((p) => p.items))
        .filter((i) => i.workItemId === id)
        .flatMap((i) => i.entries.map((e) => e.kind));
    expect(entriesFor(emails.k1Pm)).toEqual(["record_ready"]);
    for (const to of [emails.c1Pm, emails.c1Engineer, emails.orEngineer, emails.c2Engineer]) expect(entriesFor(to), to).toEqual([]);
    const digest = digests.find((d) => d.to === emails.k1Pm && d.projects.some((p) => p.items.some((i) => i.workItemId === id)))!;
    const message = notificationDigestMessage(digest, WEB_URL);
    const { text } = renderEmail(message.template, message.locale, message.values);
    expect(text).toContain("Record ready to download");
    expect(text).toContain(`https://rabaed.test/${digest.language}/work-items/${id}`);
    expect(text).not.toContain("documental-record");
  });
});

describe("scenario RP-155-2: a record that fails its checks", { timeout: SETUP_MS }, () => {
  let id = "";
  it("publishes nothing: the item shows no record, nobody downloads one and nobody is told", async () => {
    id = await closed("Cable ladders");
    await drainOutbox(worker, await handlers(failing));
    for (const by of [c1Pm, k1Pm, orEngineer]) expect((await detail(by, id)).documentalRecord).toBeNull();
    await expectHidden(c1Pm.get(`/v1/work-items/${id}/documental-record`), "failed record");
    await expectHidden(k1Pm.get(`/v1/work-items/${id}/documental-record`), "failed record, K1");
    await expectHidden(c2Engineer.get(`/v1/work-items/${id}/documental-record`), "failed record, C2");
    for (const by of [c1Pm, c1Engineer, k1Pm, orEngineer]) expect(await bell(by, id)).toEqual([]);
    // The closure and the job are untouched: the item is closed, and the job is done, not retried. (The job's attempts
    // are read from the outbox: the Job Monitor is RP-670.)
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
      select reason from admin_action where action = 'read_documental_record_alerts' and engineer_id = ${engineer.id}::uuid
    `.execute(migrator);
    expect(log.rows.map((r) => r.reason)).toContain("Checking the record alerts");
  });

  it("is made good by a Re-produce that passes: published, the alert gone, everyone told", async () => {
    expect((await reproduce(id)).statusCode).toBe(202);
    await drainOutbox(worker, quick);
    expect((await detail(c1Pm, id)).documentalRecord).toBe("published");
    expect((await download(k1Pm, id)).bytes.length).toBeGreaterThan(1000);
    expect(await alertsFor(id)).toEqual([]);
    for (const by of [c1Pm, k1Pm, orEngineer]) expect(await bell(by, id)).toHaveLength(1);
    expect(await checksOf(id)).toEqual([
      ["closure", false],
      ["reproduce", true],
    ]);
  });
});

describe("scenario RP-155-3: Re-produce in Rabaed Admin", { timeout: SETUP_MS }, () => {
  let id = "";
  let before: { bytes: Uint8Array; link: SignedUrl };
  let eventsBefore = "";
  // The item's rows are read as the migrator: its hash chain is nobody's read.
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
    const first = await recordOf(id);
    const sealedBefore = (await verifySeal(before.bytes)).timestampedAt!;
    eventsBefore = await itemState();

    expect((await reproduce(id)).statusCode).toBe(202);
    const again = await reproduce(id);
    expect([again.statusCode, again.json()], "while one waits").toEqual([409, { error: "already_queued" }]);
    await drainOutbox(worker, real);

    const after = await download(c1Pm, id);
    expect(location(after.link), "the same location, name and URL").toBe(location(before.link));
    expect(sha(after.bytes)).not.toBe(sha(before.bytes));
    const next = await recordOf(id);
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
    expect(await checksOf(id)).toEqual([
      ["closure", true],
      ["reproduce", true],
    ]);
  });

  it("keeps the replaced PDF and its fingerprint, and the Engineer's reason", async () => {
    // The history is admin-only and has no screen yet (RP-670): read as the migrator.
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
    expect(kept).toMatchObject({ previous_status: "published", action: "reproduce_documental_record", reason: REASON, target_id: id, engineer_id: engineer.id });
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

  it("needs a reason and a signed-in Engineer, is the plain 404 for an item with no record, and queues one job at a time", async () => {
    const open = await draft(at, c1Engineer, "Still a Draft");
    expect((await reproduce(open)).statusCode).toBe(404);
    expect((await reproduce("0198f5c0-0000-7000-8000-000000000000")).statusCode).toBe(404);
    expect((await reproduce(id, "   ")).statusCode).toBe(400);
    expect((await admin.browser().post(`/v1/work-items/${id}/documental-record/reproduce`, { reason: REASON })).statusCode).toBe(401);
    expect((await reproduce(id)).statusCode).toBe(202);
    await drainOutbox(worker, quick);
    expect((await reproduce(id)).statusCode, "after it was done").toBe(202);
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
    expect((await reproduce(id2)).statusCode).toBe(202);
    await drainOutbox(worker, await handlers(failing));
    expect((await detail(c1Pm, id2)).documentalRecord).toBe("published");
    expect(sha((await download(c1Pm, id2)).bytes)).toBe(sha(published.bytes));
    expect(await alertsFor(id2)).toEqual([expect.objectContaining({ status: "published", problems: ["PDF/A-3 6.1.2: a test finding"] })]);
    // The next good Re-produce clears the alert.
    expect((await reproduce(id2)).statusCode).toBe(202);
    await drainOutbox(worker, quick);
    expect(await alertsFor(id2)).toEqual([]);
  });

  it("raises an alert for a record job that gave up", async () => {
    const id3 = await closed("Cable clips");
    const broken: PdfAValidator = { validate: () => Promise.reject(new Error("docker is not running")) };
    const run = await processOutbox(worker, { handlers: await handlers(broken), maxAttempts: 1, limit: 50 });
    expect(run.dead).toBeGreaterThanOrEqual(1);
    expect(await alertsFor(id3)).toEqual([expect.objectContaining({ status: "job_failed", problems: ["docker is not running"] })]);
    // The item still shows no record, not "being prepared" forever.
    expect((await detail(c1Pm, id3)).documentalRecord).toBeNull();
  });
});

describe("scenario RP-155-3: Re-produce finds the Form photos again by their fingerprints", { timeout: SETUP_MS }, () => {
  const red = png(255, 0, 0);
  const blue = png(0, 0, 255);

  it("tells two photos of one name and no time apart, and prints both again", async () => {
    const id = await closedWithPhotos("Two same-named photos", "IMG_0001.png", [red, blue]);
    await drainOutbox(worker, quick);
    const before = await download(c1Pm, id);
    const dataBefore = new TextDecoder().decode((await attachedFiles(before.bytes))[0]!.bytes);
    // The Record Data holds each printed image's fingerprint, in the order the Documents were added.
    expect([...dataBefore.matchAll(/<photo sha256="([0-9a-f]{64})">IMG_0001\.png<\/photo>/g)].map((m) => m[1])).toEqual([sha(red), sha(blue)]);
    expect(await imageCountOf(before.bytes)).toBe(2);

    expect((await reproduce(id)).statusCode).toBe(202);
    await drainOutbox(worker, quick);
    const after = await download(c1Pm, id);
    expect(sha(after.bytes)).not.toBe(sha(before.bytes));
    expect(await imageCountOf(after.bytes), "both photos are printed again").toBe(2);
    expect(await alertsFor(id)).toEqual([]);
  });

  it("fails when a photo's file is not what the record printed: nothing is replaced, and Rabaed Admin is alerted", async () => {
    const id = await closedWithPhotos("A photo that changed", "IMG_0002.png", [red]);
    await drainOutbox(worker, quick);
    const published = await download(c1Pm, id);
    // Where the Document's file is stored is read as the migrator: no seam shows a storage key.
    const { rows } = await sql<{ storage_key: string }>`select storage_key from document where work_item_id = ${id}::uuid and file_name = 'IMG_0002.png'`.execute(migrator);
    const key = rows[0]!.storage_key;
    await files.put(key, blue, "image/png");

    expect((await reproduce(id)).statusCode).toBe(202);
    await drainOutbox(worker, quick);
    expect(sha((await download(c1Pm, id)).bytes), "the published record stays as it was").toBe(sha(published.bytes));
    const [alert] = await alertsFor(id);
    expect(alert).toMatchObject({ status: "published" });
    expect(alert!.problems).toEqual([expect.stringContaining("IMG_0002.png")]);
    expect(await checksOf(id)).toEqual([
      ["closure", true],
      ["reproduce", false],
    ]);

    // Put the file back, and the next Re-produce is made and replaces it, the alert gone.
    await files.put(key, red, "image/png");
    expect((await reproduce(id)).statusCode).toBe(202);
    await drainOutbox(worker, quick);
    expect(sha((await download(c1Pm, id)).bytes)).not.toBe(sha(published.bytes));
    expect(await alertsFor(id)).toEqual([]);
  });
});
