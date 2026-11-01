// Seam 1: the Disclaimer the owner gave the seven Rabaed Default Forms (RP-985, replacing RP-650's
// placeholder; form-engine.md §6 element 14, section 7 "Versioning"). A Form Version is immutable
// once published, so the owner's text ships as a new Version (`pnpm defaults:publish`): a record
// prints the Disclaimer of the Version its item is pinned to. Here a test Type's Form has the
// placeholder as its Version 1, and its Version 2 is published with the `pdf` block of the real
// Rabaed Default MAR document, as the publish step does. A record made after it prints the owner's
// text in both languages; one made before still prints the placeholder, and so does an item raised
// before the new Version and closed after it (it stays pinned to Version 1).
import { publishFormVersion, rabaedFormFile } from "@rabaed/admin/services";
import { createDb, type OutboxHandler } from "@rabaed/db";
import { drainOutbox, testDatabaseUrls } from "@rabaed/db/test-support";
import type { SignedUrl } from "@rabaed/domain";
import {
  attachedFiles,
  chromiumRenderer,
  documentalRecordHandler,
  fallbackFonts,
  localSealSigner,
  localTimestampAuthority,
  PINNED_VERAPDF_IMAGE,
  projectFilesFromEnv,
  s3RecordFiles,
  veraPdfDockerSession,
} from "@rabaed/worker/record";
import { sql } from "kysely";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { bilingual, buildTower, memberOnProject, ok, take, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const urls = testDatabaseUrls();
const worker = createDb(urls.app, { max: 2 });
const migrator = createDb(urls.migrator, { max: 1 });
const renderer = chromiumRenderer();
const veraPdf = veraPdfDockerSession(PINNED_VERAPDF_IMAGE);
afterAll(async () => {
  await veraPdf.close();
  await renderer.close();
  await api.close();
  await Promise.all([worker.destroy(), migrator.destroy()]);
});

const TYPE = "RECDS";
/** What RP-650 shipped in every Default Form until the owner's text came. */
const PLACEHOLDER = { en: "‹Disclaimer: the owner's text to come›", ar: "‹إخلاء المسؤولية: نص المالك لاحقًا›" };
/** The owner's text (RP-985, comment of 2026-11-01), typed here on purpose: the Default document is what is under test. */
const OWNER = {
  en: "Above inspection shall not relieve Contractor of his responsibilities to incorporate in the Works only such materials that are in conformity with the contract.",
  ar: "لا يُعفي الفحص المذكور أعلاه المقاولَ من مسؤوليته عن ألّا يُدمج في الأعمال إلا المواد المطابقة للعقد.",
};

const sections = [
  { key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] },
  {
    key: "classification",
    title: bilingual("Classification"),
    fields: [
      { key: "trade", type: "trade", label: bilingual("Trade") },
      { key: "location", type: "location", label: bilingual("Location") },
      { key: "scopes", type: "scopes", label: bilingual("Scopes") },
    ],
  },
];

const squeeze = (s: string) => s.replace(/[\s\u200E\u200F\u2066-\u2069]+/g, "");

/** Arabic as plain letters: presentation forms folded, diacritics (ً-ْ) and spaces dropped. */
const plainArabic = (s: string) => s.normalize("NFKC").replace(/[\sً-ْ]+/g, "");

interface Made {
  readonly xml: string;
  readonly lastPage: string;
}

/** The record as `by` downloads it: the Record Data inside it and the text of its last page. */
async function download(by: Caller, id: string): Promise<Made> {
  const link = (await ok(by.get(`/v1/work-items/${id}/documental-record`), 200)).json() as SignedUrl;
  const res = await fetch(link.url);
  expect(res.status).toBe(200);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  const pdf = await task.promise;
  const content = await (await pdf.getPage(pdf.numPages)).getTextContent();
  const lastPage = squeeze(content.items.map((item) => ("str" in item ? item.str : "")).join(""));
  await task.destroy();
  return { xml: new TextDecoder().decode((await attachedFiles(bytes))[0]!.bytes), lastPage };
}

let at: Tower;
let c1Engineer: Caller;
let c1Pm: Caller;
let k1Engineer: Caller;
let k1Pm: Caller;
let handler: OutboxHandler;
const made: Record<"before" | "pinned" | "after", Made> = {} as never;

const raise = async (title: string) =>
  (await ok(c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, { type: TYPE, title, answers: { model: "CT-100", trade: at.electrical, location: at.buildingA } }), 201)).json()
    .id as string;

/** Sent for review, Submitted, sent by K1's engineer to its manager, and issued Code A. */
async function close(id: string): Promise<void> {
  await take(c1Engineer, id, "send_for_review");
  await ok(c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(c1Pm, id, "submit");
  await ok(k1Engineer.post(`/v1/work-items/${id}/pick-up`));
  await take(k1Engineer, id, "send_to_manager");
  await ok(k1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(k1Pm, id, "approve_a");
}

beforeAll(async () => {
  // The Type's Form has the placeholder as Version 1, as every Default Form had before RP-985.
  await addSendBackType(migrator, TYPE, { en: "Disclaimer record", ar: "سجل إخلاء المسؤولية" }, { sections, pdf: { disclaimer: PLACEHOLDER, show_review_duration: false } });
  const c1 = await api.projectCreator();
  const k1Onboarded = await api.onboardCompany({ legalName: bilingual("Disclaimer Consultants") });
  const k1 = { company: k1Onboarded, caller: await api.acceptInvitation(k1Onboarded.invitationToken) };
  at = await buildTower(api, { c1, k1 }, "DSC");
  const participants = (await at.admin!.get(`/v1/projects/${at.projectId}/participants`)).json().participants as { id: string; isOwnCompany: boolean }[];
  const k1ParticipantId = participants.find((p) => !p.isOwnCompany)!.id;
  [c1Engineer, c1Pm, k1Engineer, k1Pm] = [
    (await memberOnProject(api, c1, at.c1ParticipantId, ["engineer"], { name: "Omar Haddad" })).caller,
    (await memberOnProject(api, c1, at.c1ParticipantId, ["project_manager"], { name: "Sara Qahtani" })).caller,
    (await memberOnProject(api, k1, k1ParticipantId, ["engineer"], { name: "Faisal Otaibi" })).caller,
    (await memberOnProject(api, k1, k1ParticipantId, ["manager"], { name: "Huda Harbi" })).caller,
  ];
  const signer = await localSealSigner();
  const timestamps = await localTimestampAuthority();
  handler = documentalRecordHandler({
    files: s3RecordFiles(projectFilesFromEnv()),
    renderer,
    signer: async () => signer,
    timestamps: async () => timestamps,
    fonts: async () => fallbackFonts(),
    webUrl: "https://rabaed.test",
    validator: veraPdf,
  });

  // Before the new Version: one item closed and its record made, one raised and left open.
  const before = await raise("Disclaimer before");
  await close(before);
  await drainOutbox(worker, { documental_record: handler });
  const pinned = await raise("Disclaimer pinned");

  // The publish step: the real Rabaed Default MAR's `pdf` block becomes this Form's Version 2.
  const marPdf = (rabaedFormFile("MAR.json") as { pdf: unknown }).pdf;
  const { form_definition_id: formId } = await migrator.selectFrom("work_item_type").select("form_definition_id").where("code", "=", TYPE).where("owner_kind", "=", "rabaed").executeTakeFirstOrThrow();
  expect(await publishFormVersion(migrator, formId!, { sections, pdf: marPdf })).toMatchObject({ ok: true, versionNo: 2 });

  const after = await raise("Disclaimer after");
  await close(after);
  await close(pinned);
  await drainOutbox(worker, { documental_record: handler });
  made.before = await download(c1Pm, before);
  made.pinned = await download(c1Pm, pinned);
  made.after = await download(c1Pm, after);
}, 300_000);

describe("the Disclaimer of a record", () => {
  it("made after the new Form Version prints the owner's text in English and in Arabic", () => {
    expect(made.after.xml).toContain(`<text lang="en">${OWNER.en}</text>`);
    expect(made.after.xml).toContain(`<text lang="ar">${OWNER.ar}</text>`);
    expect(made.after.lastPage).toContain(squeeze(OWNER.en));
    // The Arabic is on the page too. pdfjs gives it back in visual order (right to left): a word is there with its
    // letters reversed, and it reorders a ligature's or an alef-dal pair's letters, so four words that read back
    // plainly stand for it. The layout sets it right-to-left (golden.test.ts).
    const page = plainArabic(made.after.lastPage);
    for (const word of ["المذكور", "المقاول", "مسؤوليته", "المطابقة"]) {
      expect(OWNER.ar).toContain(word);
      expect(page, word).toContain([...word].reverse().join(""));
    }
    expect(made.after.xml).not.toContain("‹");
  });

  it("made before it still prints the placeholder, in both languages", () => {
    expect(made.before.xml).toContain(`<text lang="en">${PLACEHOLDER.en}</text>`);
    expect(made.before.xml).toContain(`<text lang="ar">${PLACEHOLDER.ar}</text>`);
    expect(made.before.lastPage).toContain(squeeze(PLACEHOLDER.en));
    expect(made.before.xml).not.toContain(OWNER.en);
    expect(made.before.lastPage).not.toContain(squeeze(OWNER.en));
  });

  it("of an item raised before the new Version and closed after it is its own Version's: the placeholder", () => {
    expect(made.pinned.xml).toContain(`<text lang="en">${PLACEHOLDER.en}</text>`);
    expect(made.pinned.xml).not.toContain(OWNER.en);
  });

  it("leaves the Form's Version 1 as it was when Version 2 is published", async () => {
    const versions = await sql<{ version_no: number; disclaimer: string }>`
      select v.version_no, v.schema -> 'pdf' -> 'disclaimer' ->> 'en' as disclaimer
      from form_version v join work_item_type t on t.form_definition_id = v.form_definition_id
      where t.code = ${TYPE} and t.owner_kind = 'rabaed' order by v.version_no
    `.execute(migrator);
    expect(versions.rows).toEqual([
      { version_no: 1, disclaimer: PLACEHOLDER.en },
      { version_no: 2, disclaimer: OWNER.en },
    ]);
  });
});
