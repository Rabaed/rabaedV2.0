// Seam 1 for the Snag report (RP-677; spec RP-619; ADR 0023; visibility.md V3, V14, scenarios RP-677-n).
//
// "Export PDF" in the Snag List asks for a plain PDF of what the viewer sees: the List's own Export read,
// narrowed to the chosen items, snapshotted for the worker, which prints it with the Documental Record's
// headless Chromium (here in-process, as the record's test runs it). C1 covers Building A, C2 Building B (V3);
// K1, the Consultant, raises Snags on both. The report holds none of another Company's items, a photo only
// where the viewer sees it, Step Age in weeks and no due date, and is its asker's alone.
import { createDb, type OutboxHandler } from "@rabaed/db";
import { drainOutbox, testDatabaseUrls } from "@rabaed/db/test-support";
import type { SnagReportState } from "@rabaed/domain";
import { chromiumRenderer, fallbackFonts, imageCountOf, projectFilesFromEnv, s3RecordFiles } from "@rabaed/worker/record";
import { snagReportHandler } from "@rabaed/worker/snag-report";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jpegWithExif } from "../src/demo/exif-jpeg.ts";
import { createTestApi, expectHidden, uploadDocument, type Caller } from "./support/harness.ts";
import { all, bilingual, buildTower, memberOnProject, ok, only, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const urls = testDatabaseUrls();
// The worker connects as the app role, with no Member set.
const worker = createDb(urls.app, { max: 2 });
const renderer = chromiumRenderer();
afterAll(async () => {
  await renderer.close();
  await api.close();
  await worker.destroy();
});

let at: Tower;
let c2Engineer: Caller;
let first = "";
let second = "";
let c2Snag = "";

const reportsPath = () => `/v1/projects/${at.projectId}/snag-list/reports`;
const handlers = (): Record<string, OutboxHandler> => ({
  snag_report: snagReportHandler({ files: s3RecordFiles(projectFilesFromEnv()), renderer, fonts: async () => fallbackFonts() }),
});

async function snag(title: string, location: string, photos = 0): Promise<string> {
  const id = (
    await ok(at.k1Manager.post(`/v1/projects/${at.projectId}/work-items`, { type: "SNG", title, answers: { description: title, trade: at.electrical, location } }), 201)
  ).json().id as string;
  for (let i = 0; i < photos; i++) {
    await uploadDocument(at.k1Manager, id, { fieldKey: "photos", fileName: `before-${i}.jpg`, contentType: "image/jpeg", body: jpegWithExif() });
  }
  await take(at.k1Manager, id, "raise");
  return id;
}

/** Asks for a report as `by`; the worker then runs once, and the report is asked after. */
async function report(by: Caller, body: { ids?: string[]; language: "en" | "ar" }, query = ""): Promise<SnagReportState> {
  const asked: SnagReportState = (await ok(by.post(`${reportsPath()}${query}`, body), 202)).json();
  expect(asked.status).toBe("preparing");
  expect(asked.url).toBeNull();
  expect((await ok(by.get(`${reportsPath()}/${asked.id}`), 200)).json().status).toBe("preparing");
  await drainOutbox(worker, handlers());
  const ready: SnagReportState = (await ok(by.get(`${reportsPath()}/${asked.id}`), 200)).json();
  expect(ready.status).toBe("ready");
  return { ...ready, count: asked.count };
}

async function pdfOf(state: SnagReportState): Promise<Uint8Array> {
  const res = await fetch(state.url!);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("application/pdf");
  return new Uint8Array(await res.arrayBuffer());
}

/** Everything the PDF prints, as one string without whitespace. */
async function printed(bytes: Uint8Array): Promise<string> {
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  const pdf = await task.promise;
  let text = "";
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    text += content.items.map((item) => ("str" in item ? item.str : "")).join("");
  }
  await task.destroy();
  return text.replace(/\s+/g, "");
}

beforeAll(async () => {
  const c1: Company = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  const c2 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "SRP");
  const buildingB = (await ok(c1.caller.post(`/v1/projects/${at.projectId}/locations`, { code: "BB", name: bilingual("Building B"), parentId: null }), 201)).json().id;
  await ok(c1.caller.request("PUT", `/v1/participants/${at.c1ParticipantId}/visibility`, { trade: all, location: only(at.buildingA) }));
  const c2Participant = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2Participant}/visibility`, { trade: all, location: only(buildingB) }));
  c2Engineer = (await memberOnProject(api, c2, c2Participant, ["engineer"])).caller;
  first = await snag("Cable tray not bonded", at.buildingA, 1);
  second = await snag("Duct insulation torn", at.buildingA);
  c2Snag = await snag("Paint drips on skirting", buildingB, 1);
}, 120_000);

describe("the Snag report (seam 1)", () => {
  it("holds the viewer's items only: C2's report has none of C1's, C1's none of C2's", async () => {
    const c1Report = await report(at.c1Pm, { language: "en" });
    expect(c1Report.count).toBe(2);
    const c1Text = await printed(await pdfOf(c1Report));
    expect(c1Text).toContain("Cabletraynotbonded");
    expect(c1Text).toContain("Ductinsulationtorn");
    expect(c1Text).not.toContain("Paintdrips");

    const c2Report = await report(c2Engineer, { language: "en" });
    expect(c2Report.count).toBe(1);
    const c2Text = await printed(await pdfOf(c2Report));
    expect(c2Text).toContain("Paintdripsonskirting");
    expect(c2Text).not.toContain("Cabletray");
    expect(c2Text).not.toContain("Ductinsulation");
  });

  it("holds the chosen items, never one the viewer does not see, and prints a photo, Step Age in weeks and no due date", async () => {
    const chosen = await report(at.c1Pm, { ids: [first, c2Snag], language: "en" });
    expect(chosen.count).toBe(1);
    const bytes = await pdfOf(chosen);
    const text = await printed(bytes);
    expect(text).toContain("Cabletraynotbonded");
    expect(text).not.toContain("Paintdrips");
    expect(text).toMatch(/\d+weeks?/);
    expect(text).not.toMatch(/overdue|duedate|deadline/i);
    // First's photo is drawn; second has none.
    expect(await imageCountOf(bytes)).toBe(1);
    expect(await imageCountOf(await pdfOf(await report(at.c1Pm, { ids: [second], language: "en" })))).toBe(0);
    // Every id chosen is one the viewer does not see: nothing to print, the plain 404.
    await expectHidden(at.c1Pm.post(reportsPath(), { ids: [c2Snag], language: "en" }));
  });

  it("follows the List's filters", async () => {
    const filtered = await report(at.k1Manager, { language: "en" }, `?location=${at.buildingA}`);
    const text = await printed(await pdfOf(filtered));
    expect(text).toContain("Cabletraynotbonded");
    expect(text).not.toContain("Paintdrips");
  });

  it("prints an Arabic report right to left with the Document Number left to right and Latin digits", async () => {
    const arabic = await report(at.c1Pm, { ids: [first], language: "ar" });
    const text = await printed(await pdfOf(arabic));
    // Arabic is shaped into its presentation forms, and the Document Number is left whole, left to right.
    expect(text).toMatch(/\p{Script=Arabic}/u);
    expect(text).toMatch(/SRP-SNG-\d+-\d{4}/);
    expect(text).not.toMatch(/[٠-٩]/);
  });

  it("is its asker's alone: another Member of the same Company, another Company and a made-up id get the plain 404", async () => {
    const mine = await report(at.c1Pm, { language: "en" });
    await expectHidden(at.c1Engineer.get(`${reportsPath()}/${mine.id}`));
    await expectHidden(at.k1Manager.get(`${reportsPath()}/${mine.id}`));
    await expectHidden(c2Engineer.get(`${reportsPath()}/${mine.id}`));
    await expectHidden(at.c1Pm.get(`${reportsPath()}/00000000-0000-4000-8000-000000000000`));
  });

  it("is refused to someone who is not on the Project", async () => {
    const outsider = await api.projectCreator();
    await expectHidden(outsider.caller.post(reportsPath(), { language: "en" }));
  });
});
