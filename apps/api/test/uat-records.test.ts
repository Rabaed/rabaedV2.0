// Seam 1: a Documental Record made on UAT (RP-1042, ADR 0026; visibility.md, the Verification page
// row; scenario RP-1042-1). The Records container's job is built from its environment as the
// container builds it (recordJobFromEnv with RECORD_SEALING=uat and a UAT authority made here, as the
// owner's one-off command makes the host's), and runs in-process as in documental-record.test.ts.
// The record is published only when veraPDF passes; its seal is the UAT test key; every page
// prints "UAT"; and the public verification page says it is a test record.
import { createDb, type OutboxHandler } from "@rabaed/db";
import { drainOutbox, testDatabaseUrls } from "@rabaed/db/test-support";
import { recordVerification, type RecordVerification, type SignedUrl } from "@rabaed/domain";
import {
  attachedFiles,
  chromiumRenderer,
  documentalRecordHandler,
  fallbackFonts,
  localSealSigner,
  localTimestampAuthority,
  newUatAuthority,
  PINNED_VERAPDF_IMAGE,
  projectFilesFromEnv,
  recordJobFromEnv,
  s3RecordFiles,
  UAT_MARK,
  UAT_SIGNER_NAME,
  veraPdfDockerSession,
  verifySeal,
  type PdfAValidator,
} from "@rabaed/worker/record";
import { sql } from "kysely";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { bilingual, buildTower, draft, memberOnProject, ok, take, type Company, type Tower } from "./support/tower.ts";

/** veraPDF, in one container for the file. */
const veraPdf = veraPdfDockerSession(PINNED_VERAPDF_IMAGE);
/** Stands in for veraPDF on the records other suites left behind. */
const unvalidated: PdfAValidator = { validate: async () => ({ compliant: true, problems: [] }) };

const api = await createTestApi({ files: true });
const urls = testDatabaseUrls();
const worker = createDb(urls.app, { max: 2 });
const migrator = createDb(urls.migrator, { max: 1 });
const leftovers = chromiumRenderer();
let uat: ReturnType<typeof recordJobFromEnv> | undefined;
afterAll(async () => {
  await veraPdf.close();
  await uat?.close();
  await leftovers.close();
  await api.close();
  await Promise.all([worker.destroy(), migrator.destroy()]);
});

let at: Tower;
let c1Pm: Caller;
let id = "";
let pdf: Uint8Array = new Uint8Array();
let pages: string[] = [];
let token = "";

const download = async (by: Caller, itemId: string): Promise<Uint8Array> => {
  const link = (await ok(by.get(`/v1/work-items/${itemId}/documental-record`), 200)).json() as SignedUrl;
  return new Uint8Array(await (await fetch(link.url)).arrayBuffer());
};

/** Each page's text, whitespace squeezed out. */
async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  const doc = await task.promise;
  const texts: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    texts.push(content.items.map((item) => ("str" in item ? item.str : "")).join("").replace(/\s+/g, ""));
  }
  await task.destroy();
  return texts;
}

beforeAll(async () => {
  // Records other suites left behind are not ours: made quickly with the local key first.
  const signer = await localSealSigner();
  const timestamps = await localTimestampAuthority();
  const quick = documentalRecordHandler({
    files: s3RecordFiles(projectFilesFromEnv()),
    renderer: leftovers,
    signer: async () => signer,
    timestamps: async () => timestamps,
    fonts: async () => fallbackFonts(),
    webUrl: "https://rabaed.test",
    validator: unvalidated,
  });
  await drainOutbox(worker, { documental_record: quick });

  const c1 = await api.projectCreator();
  const onboarded = await api.onboardCompany({ legalName: bilingual("UAT Records Consultants") });
  const k1: Company = { company: onboarded, caller: await api.acceptInvitation(onboarded.invitationToken) };
  at = await buildTower(api, { c1, k1 }, "UAT");
  const participants = (await at.admin!.get(`/v1/projects/${at.projectId}/participants`)).json().participants as { id: string; isOwnCompany: boolean }[];
  const k1ParticipantId = participants.find((p) => !p.isOwnCompany)!.id;
  const c1Engineer = (await memberOnProject(api, c1, at.c1ParticipantId, ["engineer"], { name: "Omar Haddad" })).caller;
  c1Pm = (await memberOnProject(api, c1, at.c1ParticipantId, ["project_manager"], { name: "Sara Qahtani" })).caller;
  const k1Pm = (await memberOnProject(api, k1, k1ParticipantId, ["manager"], { name: "Huda Harbi" })).caller;

  // The UAT container's job, from its environment: the authority as the host's secrets hold it.
  const authority = await newUatAuthority();
  uat = recordJobFromEnv("https://rabaed.test", {
    ...process.env,
    RECORD_SEALING: "uat",
    UAT_SEALING_AUTHORITY_KEY: authority.key,
    UAT_SEALING_AUTHORITY_CERTIFICATE: authority.certificate,
  });
  const handlers: Record<string, OutboxHandler> = { documental_record: documentalRecordHandler({ ...uat, validator: veraPdf }) };

  id = await draft(at, c1Engineer, "Cable trays for the UAT round");
  await take(c1Engineer, id, "send_for_review");
  await ok(c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(c1Pm, id, "submit");
  await ok(k1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(k1Pm, id, "approve_a");
  await drainOutbox(worker, handlers);

  pdf = await download(c1Pm, id);
  pages = await pageTexts(pdf);
  const xml = new TextDecoder().decode((await attachedFiles(pdf))[0]!.bytes);
  token = /link="https:\/\/rabaed\.test\/verify\/([A-Za-z0-9_-]{43})"/.exec(xml)![1]!;
}, 240_000);

describe("scenario RP-1042-1: a Documental Record made by the UAT Records container", () => {
  it("is published: its checks passed, veraPDF's PDF/A-3 validation among them", async () => {
    const { rows } = await sql<{ status: string }>`select status from documental_record where work_item_id = ${id}::uuid`.execute(migrator);
    expect(rows.map((r) => r.status)).toEqual(["published"]);
    expect(await veraPdf.validate(pdf)).toEqual({ compliant: true, problems: [] });
  });

  it("is sealed under the UAT test key, never Rabaed's own certificate, and the seal verifies", async () => {
    const check = await verifySeal(pdf);
    expect(check.valid).toBe(true);
    expect(check.longTerm).toBe(true);
    expect(check.signer).toBe(UAT_SIGNER_NAME);
  });

  it("prints UAT on every page", () => {
    expect(pages.length).toBeGreaterThan(1);
    pages.forEach((text, i) => {
      // Once in each of the four corners.
      expect(text.split(UAT_MARK).length - 1, `page ${i + 1}`).toBeGreaterThanOrEqual(4);
    });
  });

  it("is a test record on the verification page, with the page's fields and nothing more", async () => {
    const res = await api.visitor("203.0.113.42").post("/v1/verification/link", { token });
    expect(res.statusCode, res.body).toBe(200);
    const shown = res.json() as RecordVerification;
    expect(shown.testKey).toBe(true);
    expect(Object.keys(shown).sort()).toEqual(
      ["documentNumber", "fingerprints", "outcome", "project", "sealedAt", "signers", "status", "subject", "testKey"].sort(),
    );
    expect(recordVerification.safeParse(shown).success).toBe(true);
  });
});
