// Seam 1: the public verification of a Documental Record (RP-157, spec RP-632; ADR 0023;
// workflow-engine.md §7; visibility.md, the Verification page row, scenario RP-23-4). A visitor
// who isn't signed in, with no cookie, opens a record by the long link its QR prints, or by
// typing its Verification Code with its Document Number. The answer is exactly the fields the
// row lists. A code alone, a wrong pair, a record still being prepared or one that failed its
// checks all get the answer a record that doesn't exist gets. Typed codes are limited per
// visitor. A replaced record (Re-produce, RP-155) says when it was replaced, and its old
// fingerprint is still recognised. The record job runs in-process as in record-checks.test.ts.
// Where no seam shows a fact (a failed record's link and code, which no customer ever gets),
// the test reads it as the migrator, and says so.
import { createHash } from "node:crypto";
import { createDb, type OutboxHandler } from "@rabaed/db";
import { drainOutbox, testDatabaseUrls } from "@rabaed/db/test-support";
import { recordVerification, VERIFICATION_ATTEMPTS, type RecordVerification, type SignedUrl } from "@rabaed/domain";
import {
  attachedFiles,
  chromiumRenderer,
  documentalRecordHandler,
  fallbackFonts,
  localSealSigner,
  localTimestampAuthority,
  projectFilesFromEnv,
  reproduceHandler,
  s3RecordFiles,
  type PdfAValidator,
  type RecordJobDeps,
} from "@rabaed/worker/record";
import type { LightMyRequestResponse } from "fastify";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestAdmin } from "../../admin/test/support/harness.ts";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { bilingual, buildTower, detail, draft, memberOnProject, ok, take, type Company, type Tower } from "./support/tower.ts";

const SETUP_MS = 240_000;

const api = await createTestApi({ files: true });
const admin = await createTestAdmin();
const urls = testDatabaseUrls();
const worker = createDb(urls.app, { max: 2 });
const migrator = createDb(urls.migrator, { max: 1 });
const renderer = chromiumRenderer();
const files = s3RecordFiles(projectFilesFromEnv());
afterAll(async () => {
  await renderer.close();
  await admin.close();
  await api.close();
  await Promise.all([worker.destroy(), migrator.destroy()]);
});

/** The PDF/A-3 validator stands in for veraPDF: the checks themselves are record-checks.test.ts's. */
const compliant: PdfAValidator = { validate: async () => ({ compliant: true, problems: [] }) };
const failing: PdfAValidator = { validate: async () => ({ compliant: false, problems: ["PDF/A-3 6.1.2: a test finding"] }) };
const MADE_UP_TOKEN = "q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x1c";
const RETURN_REASON = "The datasheet is the wrong one";

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

let at: Tower;
let k1: Company;
let k1ParticipantId = "";
let c1Name = "";
let c1Engineer: Caller;
let c1Pm: Caller;
let c1Returner: Caller;
let k1Pm: Caller;
let k1PmId = "";
let quick: Record<string, OutboxHandler>;
let engineer: Awaited<ReturnType<typeof admin.signedInEngineer>>;

/** One visitor's browser, not signed in: each test's own address, so the limit of one never touches another. */
let visitors = 0;
const visitor = () => api.visitor(`203.0.113.${++visitors}`);

const byLink = (by: Caller, token: string) => by.post("/v1/verification/link", { token });
const byCode = (by: Caller, body: Record<string, unknown>) => by.post("/v1/verification/code", body);
const verified = async (res: Promise<LightMyRequestResponse>): Promise<RecordVerification> => {
  const got = await res;
  expect(got.statusCode, got.body).toBe(200);
  expect(got.headers["set-cookie"], "no cookie").toBeUndefined();
  return got.json();
};

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const download = async (by: Caller, id: string): Promise<Uint8Array> => {
  const link = (await ok(by.get(`/v1/work-items/${id}/documental-record`), 200)).json() as SignedUrl;
  return new Uint8Array(await (await fetch(link.url)).arrayBuffer());
};
/** What the holder of the PDF has: its QR's link, from the Record Data inside it, and the code it prints. */
async function printedOn(pdf: Uint8Array): Promise<{ token: string; code: string }> {
  const xml = new TextDecoder().decode((await attachedFiles(pdf))[0]!.bytes);
  const [, code, token] = /<verification code="([^"]+)" link="https:\/\/rabaed\.test\/verify\/([A-Za-z0-9_-]{43})"\/>/.exec(xml)!;
  return { token: token!, code: code! };
}

/**
 * A MAR the C1 engineer prepares and sends; another C1 PM Returns it; sent again, the C1 PM
 * Submits it and K1's PM issues Code A. The path to the outcome: the engineer, the PM, K1's PM.
 */
async function closedAfterAReturn(subject: string): Promise<string> {
  const id = await draft(at, c1Engineer, subject);
  await take(c1Engineer, id, "send_for_review");
  await ok(c1Returner.post(`/v1/work-items/${id}/pick-up`));
  await take(c1Returner, id, "return", { reason: RETURN_REASON });
  await take(c1Engineer, id, "send_for_review");
  await ok(c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(c1Pm, id, "submit");
  await ok(k1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(k1Pm, id, "approve_a");
  return id;
}

const reproduce = async (id: string) =>
  expect((await engineer.browser.post(`/v1/work-items/${id}/documental-record/reproduce`, { reason: "The PDF maker had a bug, RP-157 test" })).statusCode).toBe(202);

let genuine: { id: string; pdf: Uint8Array; token: string; code: string; documentNumber: string };
let replaced: { id: string; before: Uint8Array; after: Uint8Array; token: string };
let failed: { token: string; code: string; documentNumber: string };

beforeAll(async () => {
  const c1 = await api.projectCreator();
  const onboarded = await api.onboardCompany({ legalName: bilingual("Verification Consultants") });
  k1 = { company: onboarded, caller: await api.acceptInvitation(onboarded.invitationToken) };
  at = await buildTower(api, { c1, k1 }, "VER");
  const participants = (await at.admin!.get(`/v1/projects/${at.projectId}/participants`)).json().participants as {
    id: string;
    isOwnCompany: boolean;
    company: { legalName: { en: string } };
  }[];
  k1ParticipantId = participants.find((p) => !p.isOwnCompany)!.id;
  c1Name = participants.find((p) => p.isOwnCompany)!.company.legalName.en;
  c1Engineer = (await memberOnProject(api, c1, at.c1ParticipantId, ["engineer"], { name: "Omar Haddad" })).caller;
  c1Pm = (await memberOnProject(api, c1, at.c1ParticipantId, ["project_manager"], { name: "Sara Qahtani" })).caller;
  c1Returner = (await memberOnProject(api, c1, at.c1ParticipantId, ["project_manager"], { name: "Nadia Returns" })).caller;
  const huda = await memberOnProject(api, k1, k1ParticipantId, ["manager"], { name: "Huda Harbi" });
  k1Pm = huda.caller;
  k1PmId = huda.id;
  engineer = await admin.signedInEngineer();
  quick = await handlers(compliant);
  // Anything earlier tests left in the outbox is not ours to judge.
  await drainOutbox(worker, quick);

  const [genuineId, replacedId] = await Promise.all([closedAfterAReturn("Cable trays for Building A"), closedAfterAReturn("Cable glands")]);
  await drainOutbox(worker, quick);
  const pdf = await download(c1Pm, genuineId);
  genuine = { id: genuineId, pdf, ...(await printedOn(pdf)), documentNumber: (await detail(c1Pm, genuineId)).documentNumber! };

  const before = await download(c1Pm, replacedId);
  await reproduce(replacedId);
  await drainOutbox(worker, quick);
  replaced = { id: replacedId, before, after: await download(c1Pm, replacedId), token: (await printedOn(before)).token };

  // A record whose checks failed: nobody can download it, so its link and code are read from what the
  // job stored, as the migrator.
  const failedId = await closedAfterAReturn("Cable ladders");
  await drainOutbox(worker, await handlers(failing));
  const { rows } = await sql<{ storage_key: string; code: string }>`
    select f.storage_key, r.verification_code as code
    from documental_record r join stored_file f on f.id = r.record_data_file_id
    where r.work_item_id = ${failedId}::uuid and r.status = 'failed_checks'
  `.execute(migrator);
  const xml = new TextDecoder().decode((await files.get(rows[0]!.storage_key))!);
  failed = {
    token: /\/verify\/([A-Za-z0-9_-]{43})/.exec(xml)![1]!,
    code: rows[0]!.code,
    documentNumber: (await detail(c1Pm, failedId)).documentNumber!,
  };
}, SETUP_MS);

describe("scenario RP-23-4: a visitor not signed in scans the record's QR", { timeout: SETUP_MS }, () => {
  let shown: RecordVerification;

  it("opens the record by the long link, with no session and no cookie", async () => {
    shown = await verified(byLink(visitor(), genuine.token));
    expect(shown.status).toBe("genuine");
    expect(shown.replacedAt).toBeNull();
  });

  it("shows exactly the fields of the Verification page row, and nothing more", () => {
    expect(Object.keys(shown).sort()).toEqual(
      ["documentNumber", "fingerprints", "outcome", "project", "replacedAt", "sealedAt", "signers", "status", "subject"].sort(),
    );
    expect(Object.keys(shown.outcome).sort()).toEqual(["code", "name"]);
    expect(Object.keys(shown.fingerprints).sort()).toEqual(["current", "replaced"]);
    for (const signer of shown.signers) expect(Object.keys(signer).sort()).toEqual(["company", "name", "positions"]);
    expect(recordVerification.strict().safeParse(shown).success).toBe(true);
  });

  it("shows the Document Number, Subject, Project, outcome and sealed date of the record", async () => {
    expect(shown.documentNumber).toBe(genuine.documentNumber);
    expect(shown.subject).toBe("Cable trays for Building A");
    expect(shown.project.en).toBeTruthy();
    expect(shown.outcome.code).toBe("A");
    expect(new Date(shown.sealedAt).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("names each signer on the record's path with their Position and Company, never the Return or who took it", () => {
    expect(shown.signers.map((s) => [s.name.en, s.positions.map((p) => p.en), s.company.en])).toEqual([
      ["Omar Haddad", ["Engineer"], c1Name],
      ["Sara Qahtani", ["Project Manager"], c1Name],
      ["Huda Harbi", ["Manager"], "Verification Consultants"],
    ]);
    expect(JSON.stringify(shown)).not.toContain("Nadia Returns");
    expect(JSON.stringify(shown)).not.toContain(RETURN_REASON);
  });

  it("names the signers as the record printed them, not as they are now", async () => {
    await ok(k1.caller.request("PUT", `/v1/participants/${k1ParticipantId}/members/${k1PmId}/positions`, { positions: ["engineer"] }));
    const again = await verified(byLink(visitor(), genuine.token));
    expect(again.signers[2]!.positions.map((p) => p.en)).toEqual(["Manager"]);
    await ok(k1.caller.request("PUT", `/v1/participants/${k1ParticipantId}/members/${k1PmId}/positions`, { positions: ["manager"] }));
  });

  it("never shows a Document, a Form answer or the live item", () => {
    const body = JSON.stringify(shown);
    for (const hidden of ["datasheet", "ACME Cables", "Galvanised", genuine.id, at.projectId, "storage", "currentStep", "workItemId"]) {
      expect(body, hidden).not.toContain(hidden);
    }
  });

  it("gives the PDF's fingerprint, so the page can tell a dropped copy is the original", () => {
    expect(shown.fingerprints).toEqual({ current: sha(genuine.pdf), replaced: [] });
  });

  it("opens the same record by its Verification Code with its Document Number, typed loosely", async () => {
    expect(await verified(byCode(visitor(), { code: genuine.code, documentNumber: genuine.documentNumber }))).toEqual(shown);
    const loose = genuine.code.toLowerCase().replace("-", " ");
    expect(await verified(byCode(visitor(), { code: loose, documentNumber: ` ${genuine.documentNumber.toLowerCase()} ` }))).toEqual(shown);
  });

  it("refuses the code alone exactly as a wrong code: the same answer as a record that doesn't exist", async () => {
    const v = visitor();
    await expectHidden(byCode(v, { code: genuine.code }), "the code alone");
    await expectHidden(byCode(v, { code: genuine.code, documentNumber: "" }), "an empty Document Number");
    await expectHidden(byCode(v, { code: genuine.code, documentNumber: failed.documentNumber }), "another record's Document Number");
    await expectHidden(byCode(v, { code: "ZZZZ-ZZZZ", documentNumber: genuine.documentNumber }), "a wrong code");
    await expectHidden(byCode(v, { code: "#not-a-code!", documentNumber: genuine.documentNumber }), "not a code at all");
    await expectHidden(byCode(v, { documentNumber: genuine.documentNumber }), "the Document Number alone");
    await expectHidden(byCode(v, {}), "nothing");
    await expectHidden(byLink(v, MADE_UP_TOKEN), "a made-up link");
    await expectHidden(byLink(v, "short"), "not a link at all");
  });

  it("answers a signed-in Member of another Company the same as anyone", async () => {
    expect(await verified(byLink(c1Pm, genuine.token))).toEqual(shown);
  });
});

describe("a record that isn't published", { timeout: SETUP_MS }, () => {
  // A record saved 'preparing' exists only inside the job's own transaction until its checks have run, so no
  // visitor's request can meet one here; seam 2 (documental-record-verification-rls.test.ts) covers it.
  it("is the record that doesn't exist when its checks failed, by link or by code", async () => {
    await expectHidden(byLink(visitor(), failed.token), "by link");
    await expectHidden(byCode(visitor(), { code: failed.code, documentNumber: failed.documentNumber }), "by code");
  });
});

describe("a record replaced by a corrected copy (Re-produce, RP-155)", { timeout: SETUP_MS }, () => {
  let shown: RecordVerification;

  it("says it was replaced by a corrected copy, and when", async () => {
    shown = await verified(byLink(visitor(), replaced.token));
    expect(shown.status).toBe("replaced");
    expect(shown.replacedAt).not.toBeNull();
    expect(new Date(shown.sealedAt).getTime()).toBeLessThanOrEqual(new Date(shown.replacedAt!).getTime() + 1000);
  });

  it("still recognises the old copy's fingerprint, as replaced on that date, and gives the corrected copy's as current", () => {
    expect(shown.fingerprints.current).toBe(sha(replaced.after));
    expect(shown.fingerprints.replaced).toEqual([{ sha256: sha(replaced.before), replacedAt: shown.replacedAt }]);
  });

  it("is opened by the old copy's QR, which the corrected copy prints too", async () => {
    expect((await printedOn(replaced.after)).token).toBe(replaced.token);
  });
});

describe("typing codes is limited per visitor", { timeout: SETUP_MS }, () => {
  it("refuses a visitor's attempts past the limit, the right pair too, and only that visitor's", async () => {
    const v = visitor();
    const tries = VERIFICATION_ATTEMPTS.perVisitor;
    for (let i = 0; i < tries; i++) await expectHidden(byCode(v, { code: "ZZZZ-ZZZZ", documentNumber: `VER-${i}` }), `try ${i + 1}`);
    const refused = await byCode(v, { code: genuine.code, documentNumber: genuine.documentNumber });
    expect([refused.statusCode, refused.json()]).toEqual([429, { error: "too_many_attempts" }]);
    // Another visitor is not held back, and the link, which can't be guessed, is not limited.
    await verified(byCode(visitor(), { code: genuine.code, documentNumber: genuine.documentNumber }));
    await verified(byLink(v, genuine.token));
  });

  it("counts the right pairs too", async () => {
    const v = visitor();
    for (let i = 0; i < VERIFICATION_ATTEMPTS.perVisitor; i++) await verified(byCode(v, { code: genuine.code, documentNumber: genuine.documentNumber }));
    expect((await byCode(v, { code: genuine.code, documentNumber: genuine.documentNumber })).statusCode).toBe(429);
  });

  it("lets the visitor try again once the window has passed", async () => {
    const v = visitor();
    for (let i = 0; i < VERIFICATION_ATTEMPTS.perVisitor; i++) await expectHidden(byCode(v, { code: "ZZZZ-ZZZZ", documentNumber: "VER" }));
    expect((await byCode(v, { code: genuine.code, documentNumber: genuine.documentNumber })).statusCode).toBe(429);
    api.advanceClock(VERIFICATION_ATTEMPTS.windowMinutes * 60_000 + 1000);
    await verified(byCode(v, { code: genuine.code, documentNumber: genuine.documentNumber }));
  });
});
