// Seam 1: the Documental Record lists a shared reply Screen's attachments and prints its photos
// (RP-1029; ADR 0023, ADR 0024; form-engine.md §6, settled 2026-10-31; visibility.md V19, the
// Documental Record row, scenario RP-1029-1). A test Type's Workflow shows a Screen with a photos
// and an attachments field at two Transitions: Send to Manager, a move inside K1 (its event
// internal), and Code C, the shared close. K1's Engineer adds a site photo and a test report to the
// first and Sends it to the Manager; the Manager adds a photo and a report of his own to the code's
// Screen and issues Code C. The record job runs once and the tests read what each Member downloads.
//
// The record lists the code's report with the Documents and gives it its appendix entry, by its
// fingerprint; it prints the code's photo as a photo grid under its Screen section's title, with
// its fingerprint, in English and Arabic. Neither of the Engineer's files is in its pages or its
// Record Data. C1, K1 and the Owner Representative download the same record; C2 gets the plain 404
// for it and for the files. Seam 2: packages/db/test/documental-record-reply-files-rls.test.ts.
import { createHash, randomUUID } from "node:crypto";
import { publishFormVersion } from "@rabaed/admin/services";
import { createDb, type OutboxHandler } from "@rabaed/db";
import { addTestScreen, addTestWorkflow, drainOutbox, expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import type { DocumentList, SignedUrl } from "@rabaed/domain";
import {
  attachedFiles,
  chromiumRenderer,
  documentalRecordHandler,
  fallbackFonts,
  localSealSigner,
  localTimestampAuthority,
  projectFilesFromEnv,
  s3RecordFiles,
} from "@rabaed/worker/record";
import { sql } from "kysely";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jpegWithExif } from "../src/demo/exif-jpeg.ts";
import { createTestApi, readById, uploadDocument, type Caller } from "./support/harness.ts";
import { all, bilingual, memberOnProject, ok, only, take, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const urls = testDatabaseUrls();
// The worker connects as the app role, with no Member set.
const worker = createDb(urls.app, { max: 2 });
const migrator = createDb(urls.migrator, { max: 1 });
const renderer = chromiumRenderer();
afterAll(async () => {
  await renderer.close();
  await api.close();
  await Promise.all([worker.destroy(), migrator.destroy()]);
});

const TYPE = "RPRF";
/** A Consultant Position that may attach files in Submittals: no Rabaed Default one does. */
const REVIEWER = "rp1029_api_reviewer";
const t = (en: string, ar: string) => ({ en, ar });
const schema = {
  sections: [
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
  ],
};
/** A reply Screen of the acting Consultant's own evidence: its photos and its reports. */
const evidenceScreen = (key: string, title: { en: string; ar: string }) => ({
  sections: [
    {
      key,
      title,
      fields: [
        { key: `${key}_photos`, type: "photos", maxFiles: 5, label: t("Site photos", "صور الموقع") },
        { key: `${key}_reports`, type: "attachments", label: t("Test reports", "تقارير الاختبار") },
        { key: "remarks", type: "textarea", label: t("Remarks", "الملاحظات") },
      ],
    },
  ],
});
const CODE_TITLE = t("Code evidence", "أدلة الرمز");

const bytes = {
  engineerPhoto: jpegWithExif({ takenAt: "2026:10:20 08:00:00", offset: "+03:00" }),
  engineerReport: Buffer.from("%PDF-1.7 the Engineer's own report (test)"),
  codePhoto: jpegWithExif({ takenAt: "2026:10:21 09:30:00", offset: "+03:00" }),
  codeReport: Buffer.from("%PDF-1.7 the cube test the code shares (test)"),
};
const names = { engineerPhoto: "engineer-site.jpg", engineerReport: "engineer-report.pdf", codePhoto: "code-site.jpg", codeReport: "cube-test.pdf" };

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const squeeze = (s: string) => s.replace(/\s+/g, "");

let projectId = "";
let id = "";
const people = {} as Record<"c1Engineer" | "c1Pm" | "k1Engineer" | "k1Manager" | "orEngineer" | "c2Engineer", Caller>;
const fileIds = {} as Record<keyof typeof names, string>;
const who = new Map<Caller, string>();

interface Made {
  readonly bytes: Uint8Array;
  readonly text: string;
  readonly xml: string;
}
let made: Made;

/** The record as `by` downloads it: its text without whitespace, and its Record Data. */
async function download(by: Caller): Promise<Made> {
  const link = (await ok(by.get(`/v1/work-items/${id}/documental-record`), 200)).json() as SignedUrl;
  const pdfBytes = new Uint8Array(await (await fetch(link.url)).arrayBuffer());
  const task = getDocument({ data: pdfBytes.slice(), useSystemFonts: false });
  const pdf = await task.promise;
  const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    pages.push(squeeze(content.items.map((item) => ("str" in item ? item.str : "")).join("")));
  }
  await task.destroy();
  const attached = await attachedFiles(pdfBytes);
  return { bytes: pdfBytes, text: pages.join(""), xml: new TextDecoder().decode(attached[0]!.bytes) };
}

/** `by` adds `key`'s file to the reply Screen field `field` of the item; its Document's id. */
const addReplyFile = (by: Caller, field: string, key: keyof typeof names, contentType: string) =>
  uploadDocument(by, id, { fieldKey: field, reply: true, fileName: names[key], contentType, body: bytes[key] } as Parameters<typeof uploadDocument>[2]);

/** The `<section>` of the Record Data's `<form>` whose English title is `title`. */
const sectionOf = (xml: string, title: string) =>
  [...(/<form>([\s\S]*?)<\/form>/.exec(xml)?.[1] ?? "").matchAll(/<section>([\s\S]*?)<\/section>/g)].map((m) => m[1]!).find((s) => s.includes(`<title lang="en">${title}</title>`));

beforeAll(async () => {
  const run = (text: string) => sql.raw(text).execute(migrator) as Promise<{ rows: unknown[] }>;
  const engineerScreen = await addTestScreen(run, `rp1029_api_engineer_${randomUUID().slice(0, 8)}`, evidenceScreen("engineer", t("Engineer evidence", "أدلة المهندس")), []);
  const codeScreen = await addTestScreen(run, `rp1029_api_code_${randomUUID().slice(0, 8)}`, evidenceScreen("code", CODE_TITLE), []);
  const workflowId = await addTestWorkflow(run, { name: bilingual(`RP-1029 reply files ${randomUUID().slice(0, 8)}`), screens: { send_to_manager: engineerScreen, revise_c: codeScreen } });
  const { id: formId } = await migrator
    .insertInto("form_definition")
    .values({ owner_kind: "rabaed", name: JSON.stringify(t("Reply files (test)", "ملفات الرد (اختبار)")) })
    .returning("id")
    .executeTakeFirstOrThrow();
  await migrator
    .insertInto("work_item_type")
    .values({ owner_kind: "rabaed", module_key: "submittals", code: TYPE, name: JSON.stringify(t("Reply files", "ملفات الرد")), workflow_definition_id: workflowId, outcome_kind: "review_code", form_definition_id: formId })
    .execute();
  expect(await publishFormVersion(migrator, formId, schema)).toMatchObject({ ok: true });
  await run(`
    with p as (
      insert into position (owner_kind, base_role, key, name, sort)
      values ('rabaed', 'consultant', '${REVIEWER}', '{"en": "Reviewing engineer", "ar": "مهندس المراجعة"}', 99)
      on conflict (base_role, key) do update set sort = excluded.sort
      returning id
    )
    insert into position_permission (position_id, module_key, permission)
    select p.id, 'submittals', x from p, unnest(array['view', 'review', 'approve', 'attach']) x
    on conflict do nothing
  `);

  const c1: Company = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  const or = await api.authorizedPerson();
  const c2 = await api.authorizedPerson();
  projectId = (await api.createProject(c1.caller, { code: "RRF" })).id;
  const post = async (path: string, body: unknown) => (await ok(c1.caller.post(`/v1/projects/${projectId}/${path}`, body), 201)).json().id as string;
  const electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  const buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
  const buildingB = await post("locations", { code: "BB", name: bilingual("Building B"), parentId: null });
  const c1ParticipantId = (await c1.caller.get(`/v1/projects/${projectId}/participants`)).json().participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id as string;
  await ok(c1.caller.request("PUT", `/v1/participants/${c1ParticipantId}/visibility`, { trade: all, location: all }));
  const participant = async (company: Company, role: "consultant" | "owner_representative" | "contractor", location: typeof all | ReturnType<typeof only> = all) => {
    const pid = await api.addParticipant(c1.caller, projectId, company.company, role);
    await ok(c1.caller.request("PUT", `/v1/participants/${pid}/visibility`, { trade: all, location }));
    return pid;
  };
  const k1ParticipantId = await participant(k1, "consultant");
  const orParticipantId = await participant(or, "owner_representative");
  // Another Contractor of the same Trade, covering Building B only (V3).
  const c2ParticipantId = await participant(c2, "contractor", only(buildingB));
  people.c1Engineer = (await memberOnProject(api, c1, c1ParticipantId, ["engineer"], { name: "Hafiz Hamdan" })).caller;
  people.c1Pm = (await memberOnProject(api, c1, c1ParticipantId, ["project_manager"], { name: "Ali Sonour" })).caller;
  people.k1Engineer = (await memberOnProject(api, k1, k1ParticipantId, [REVIEWER], { name: "Ahmed bin Said" })).caller;
  people.k1Manager = (await memberOnProject(api, k1, k1ParticipantId, ["manager", REVIEWER], { name: "Mohammed Al Shamsi" })).caller;
  people.orEngineer = (await memberOnProject(api, or, orParticipantId, ["engineer"], { name: "Faisal Al Otaibi" })).caller;
  people.c2Engineer = (await memberOnProject(api, c2, c2ParticipantId, ["engineer"], { name: "Yousef Karim" })).caller;
  for (const [key, by] of Object.entries(people)) who.set(by, key);

  const signer = await localSealSigner();
  const timestamps = await localTimestampAuthority();
  const handler: OutboxHandler = documentalRecordHandler({
    files: s3RecordFiles(projectFilesFromEnv()),
    renderer,
    signer: async () => signer,
    timestamps: async () => timestamps,
    fonts: async () => fallbackFonts(),
    webUrl: "https://rabaed.test",
    // PDF/A validity is the record checks' own suites'.
    validator: { validate: async () => ({ compliant: true, problems: [] }) },
  });
  // Anything earlier tests left in the outbox is not ours to judge.
  await drainOutbox(worker, { documental_record: handler });

  id = (
    await ok(people.c1Engineer.post(`/v1/projects/${projectId}/work-items`, { type: TYPE, title: "Pump skid", answers: { model: "PS-40", trade: electrical, location: buildingA } }), 201)
  ).json().id as string;
  await take(people.c1Engineer, id, "send_for_review");
  await ok(people.c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(people.c1Pm, id, "submit");
  await ok(people.k1Engineer.post(`/v1/work-items/${id}/pick-up`));
  fileIds.engineerPhoto = await addReplyFile(people.k1Engineer, "engineer_photos", "engineerPhoto", "image/jpeg");
  fileIds.engineerReport = await addReplyFile(people.k1Engineer, "engineer_reports", "engineerReport", "application/pdf");
  await take(people.k1Engineer, id, "send_to_manager");
  await ok(people.k1Manager.post(`/v1/work-items/${id}/pick-up`));
  fileIds.codePhoto = await addReplyFile(people.k1Manager, "code_photos", "codePhoto", "image/jpeg");
  fileIds.codeReport = await addReplyFile(people.k1Manager, "code_reports", "codeReport", "application/pdf");
  await take(people.k1Manager, id, "revise_c", { answers: { remarks: "Raise the cover" } });

  await drainOutbox(worker, { documental_record: handler });
  made = await download(people.c1Engineer);
}, 600_000);

describe("RP-1029: the record lists the shared code's attachments and prints its photos", () => {
  it("lists the code's report with the Documents, and gives it its appendix entry by its fingerprint", () => {
    expect(/<documents>([\s\S]*?)<\/documents>/.exec(made.xml)![1]).toContain(names.codeReport);
    const appendix = /<appendix>([\s\S]*?)<\/appendix>/.exec(made.xml)?.[1] ?? "";
    expect(appendix).toMatch(new RegExp(`<file n="1" sha256="${sha256(bytes.codeReport)}">[\\s\\S]*?<name>${names.codeReport.replace(".", "\\.")}</name>`));
    expect(made.text).toContain(names.codeReport);
  });

  it("prints the code's photo as a photo grid under its Screen section's title, with its fingerprint", () => {
    const section = sectionOf(made.xml, CODE_TITLE.en);
    expect(section, made.xml).toBeDefined();
    expect(section).toContain(`<label lang="en">Site photos</label>`);
    expect([...section!.matchAll(/<photo[^>]*sha256="([0-9a-f]{64})"[^>]*>([^<]*)<\/photo>/g)].map((m) => [m[2], m[1]])).toEqual([[names.codePhoto, sha256(bytes.codePhoto)]]);
    expect(made.text).toContain(names.codePhoto);
    expect(made.text).toContain(squeeze(CODE_TITLE.en));
  });

  it("is in Arabic and English: the section title and the grid's label in each", () => {
    const section = sectionOf(made.xml, CODE_TITLE.en)!;
    expect(section).toContain(`<title lang="ar">${CODE_TITLE.ar}</title>`);
    expect(section).toContain(`<label lang="ar">صور الموقع</label>`);
    // The Project's record language: both, so each text holds both.
    expect(made.xml).toMatch(/<recordData[^>]* language="bilingual"/);
    expect(section).toContain(`<title lang="en">${CODE_TITLE.en}</title>`);
  });
});

// Scenario RP-1029-1 (docs/visibility/scenarios/RP-1029.md): the record carries only what a shared
// event took before the close (V19). Seam 2: packages/db/test/documental-record-reply-files-rls.test.ts.
describe("RP-1029-1: never a file an internal event took", () => {
  it("holds neither of the Engineer's files in its pages, its Record Data or its appendix: of the four, only the code's two", () => {
    const all = Object.keys(names) as (keyof typeof names)[];
    const code = ["codePhoto", "codeReport"];
    // Each read is checked against all four files, so the code's two prove the read finds a file it holds.
    expect(all.filter((k) => made.text.includes(names[k])), "pages").toEqual(code);
    expect(all.filter((k) => made.xml.includes(names[k])), "Record Data").toEqual(code);
    expect(all.filter((k) => made.xml.includes(sha256(bytes[k]))), "fingerprints").toEqual(code);
    const titles = [...made.xml.matchAll(/<section>\s*<title lang="ar">[^<]*<\/title>\s*<title lang="en">([^<]*)<\/title>/g)].map((m) => m[1]);
    expect(["Engineer evidence", CODE_TITLE.en].filter((title) => titles.includes(title)), made.xml).toEqual([CODE_TITLE.en]);
  });

  it("is the same record for C1, K1 and the Owner Representative; the plain 404 for C2", async () => {
    for (const reader of [people.c1Pm, people.k1Engineer, people.k1Manager, people.orEngineer]) expect(sha256((await download(reader)).bytes), who.get(reader)).toBe(sha256(made.bytes));
    const recordOfItem = async (by: Caller) => (await readById<SignedUrl>(`/v1/work-items/${id}/documental-record`)(by)).map((link) => ({ id: link.url.includes(`/work-items/${id}/`) ? id : link.url }));
    await expectHiddenFrom({ read: recordOfItem, target: id, seenBy: [people.c1Pm, people.orEngineer], hiddenFrom: people.c2Engineer, name: (by) => who.get(by) ?? "someone" });
  });

  it("C1 and the Owner Representative read the code's files; only K1 reads the Engineer's; C2 reads none", async () => {
    const documents = async (by: Caller) => (await readById<DocumentList>(`/v1/work-items/${id}/documents`)(by)).flatMap((l) => l.documents);
    const download = (file: string) => async (by: Caller) => (await readById<{ url: string }>(`/v1/work-items/${id}/documents/${file}/download`)(by)).map(() => ({ id: file }));
    const name = (by: Caller) => who.get(by) ?? "someone";
    for (const file of [fileIds.codePhoto, fileIds.codeReport]) {
      for (const read of [documents, download(file)]) {
        await expectHiddenFrom({ read, target: file, seenBy: [people.c1Engineer, people.orEngineer, people.k1Manager], hiddenFrom: people.c2Engineer, name, label: "the code's reply file" });
      }
    }
    for (const file of [fileIds.engineerPhoto, fileIds.engineerReport]) {
      for (const read of [documents, download(file)]) {
        await expectHiddenFrom({
          read,
          target: file,
          seenBy: [people.k1Engineer, people.k1Manager],
          hiddenFrom: [people.c1Engineer, people.c1Pm, people.orEngineer, people.c2Engineer],
          name,
          label: "the Engineer's reply file",
        });
      }
    }
  });
});
