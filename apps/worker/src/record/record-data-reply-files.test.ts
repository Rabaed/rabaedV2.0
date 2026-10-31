import type { DocumentFact, RecordFacts, TransitionFact } from "@rabaed/db";
import { describe, expect, it } from "vitest";
import { appendixOf } from "./appendix.ts";
import { attachmentFieldKeysOf, printedPhotosOf, type RecordBlock } from "./form-content.ts";
import { goldenFacts } from "./golden-fixtures.ts";
import { recordDataOf, recordDataXml } from "./record-data.ts";

// A reply Screen's own files (ADR 0024; form-engine.md §6, settled 2026-10-31, RP-1029): a shared
// event's `attachments` reply files are listed with the Documents (element 9) and get appendix
// pages; its `photos` reply files print as a photo grid, as a Form `photos` field does. The facts
// hold only files a shared event took before the close (app.documents_shared_before_close, V19):
// which files reach them is the database's to say (seam 2), how they print is the worker's.

const verification = { code: "7K2M-9QXD", link: "https://rabaed.test/verify/x" };
const t = (en: string, ar: string) => ({ en, ar });

/** The code's Screen with a section of the Consultant's own evidence: site photos and test reports. */
const evidence = {
  key: "site_evidence",
  title: t("Site evidence", "أدلة الموقع"),
  fields: [
    { key: "site_photos", type: "photos", maxFiles: 5, label: t("Site photos", "صور الموقع") },
    { key: "test_reports", type: "attachments", label: t("Test reports", "تقارير الاختبار") },
  ],
};

const replyDoc = (fileName: string, contentType: string, storageKey: string, fieldKey: string, takenAt: string | null = null): DocumentFact => ({
  fileName,
  contentType,
  size: 1000,
  storageKey,
  sha256: null,
  fieldKey,
  itemKey: null,
  takenAt,
});
const sitePhoto = replyDoc("slab-edge.jpg", "image/jpeg", "reply-photo-1", "site_photos", "2026-10-14T07:00:00.000Z");
const report = replyDoc("cube-test.pdf", "application/pdf", "reply-file-1", "test_reports");

/** The WIR golden, its code's Screen holding the evidence section and the code having taken both files. */
function withEvidence(language: RecordFacts["recordLanguage"]): RecordFacts {
  const wir = goldenFacts("wir", language);
  const closing = wir.transitions.at(-1)!;
  const form = closing.actionForm as { sections: unknown[] };
  const coded: TransitionFact = { ...closing, actionForm: { sections: [...form.sections, evidence] } };
  return { ...wir, documents: [...wir.documents, sitePhoto, report], transitions: [...wir.transitions.slice(0, -1), coded] };
}

type Photos = Extract<RecordBlock, { kind: "photos" }>;
const sectionTitled = (facts: RecordFacts, en: string) => recordDataOf(facts, verification).sections.find((s) => s.title.en === en);
const sectionTitles = (facts: RecordFacts) => recordDataOf(facts, verification).sections.map((s) => s.title.en);

describe("a reply Screen's files on the record (RP-1029)", () => {
  it("lists the shared code's attachments reply file with the Documents", () => {
    expect(recordDataOf(withEvidence("en"), verification).documents.map((d) => d.fileName)).toEqual(["cube-test.pdf"]);
    expect(attachmentFieldKeysOf(withEvidence("en"))).toEqual(new Set(["test_reports"]));
  });

  it("prints the shared code's photos reply files as a photo grid, under the Screen section's title", () => {
    const section = sectionTitled(withEvidence("en"), "Site evidence");
    expect(section?.blocks).toEqual([
      { kind: "photos", label: { en: "Site photos" }, photos: [{ fileName: "slab-edge.jpg", takenAt: "2026-10-14T07:00:00.000Z", storageKey: "reply-photo-1", sha256: null }] },
    ]);
    expect(printedPhotosOf(withEvidence("en")).map((d) => d.storageKey)).toContain("reply-photo-1");
  });

  it("is in each language the record prints", () => {
    const ar = recordDataOf(withEvidence("ar"), verification).sections.find((s) => s.title.ar === "أدلة الموقع");
    expect((ar?.blocks[0] as Photos).label).toEqual({ ar: "صور الموقع" });
    const both = sectionTitled(withEvidence("bilingual"), "Site evidence");
    expect(both?.title).toEqual(t("Site evidence", "أدلة الموقع"));
    expect((both?.blocks[0] as Photos).label).toEqual(t("Site photos", "صور الموقع"));
  });

  it("holds the photo in a photos block of its Record Data and the reply file in its documents, as it prints them", () => {
    const xml = recordDataXml(recordDataOf(withEvidence("en"), verification, new Map(), () => true, new Map([["reply-photo-1", "e".repeat(64)]])));
    expect(xml).toMatch(/<title lang="en">Site evidence<\/title>[\s\S]*<photos>[\s\S]*slab-edge\.jpg/);
    expect(xml).toContain(`sha256="${"e".repeat(64)}"`);
    expect(/<documents>([\s\S]*?)<\/documents>/.exec(xml)![1]).toContain("cube-test.pdf");
  });

  it("gives the attachments reply file its appendix entry, by its fingerprint, and the photo none", async () => {
    const facts = withEvidence("en");
    const sha = "d".repeat(64);
    const store = { put: async () => {}, get: async () => null, sha256: async (key: string) => (key === "reply-file-1" ? sha : null) };
    // Past the size limit (0): held in Rabaed, listed by name and fingerprint, so no bytes are read.
    expect((await appendixOf(facts, store, 0)).entries).toEqual([{ way: "held", fileName: "cube-test.pdf", sha256: sha }]);
  });

  it("prints a reply photo only once, when two Transitions on the item show the same Screen", () => {
    const facts = withEvidence("en");
    const earlier = { ...facts.transitions.at(-1)!, kind: "send", outcomeMode: null, answers: null };
    const twice = { ...facts, transitions: [...facts.transitions.slice(0, -1), earlier, facts.transitions.at(-1)!] };
    expect(recordDataOf(twice, verification).sections.filter((s) => s.title.en === "Site evidence")).toHaveLength(1);
    expect(recordDataOf(twice, verification).documents.map((d) => d.fileName)).toEqual(["cube-test.pdf"]);
  });

  it("prints nothing of the files a shared Code off the path took: sent back, then issued again (path only, as reply checklists)", () => {
    const facts = withEvidence("en");
    const code = facts.transitions.at(-1)!;
    // The first Code went on to the Owner Representative, who Sent it Back; the Code issued again shows a Screen with no file field.
    const first = { ...code, kind: "submit", toStepId: "or_review" };
    const sentBack = { ...code, kind: "send_back", fromStepId: "or_review", toStepId: code.fromStepId, outcomeMode: null, answers: null, actionForm: null };
    const again = { ...code, actionForm: { sections: [] } };
    const reissued = { ...facts, transitions: [...facts.transitions.slice(0, -1), first, sentBack, again] };
    const data = recordDataOf(reissued, verification);
    expect(data.documents.map((d) => d.fileName)).toEqual([]);
    expect(data.sections.map((s) => s.title.en)).toEqual(sectionTitles(goldenFacts("wir", "en")));
    expect(attachmentFieldKeysOf(reissued)).toEqual(new Set());
    expect(printedPhotosOf(reissued).map((d) => d.storageKey)).toEqual(["photo-1", "photo-2", "photo-3"]);
  });

  it("prints no section for a reply photos field the shared events took no file into", () => {
    const facts = withEvidence("en");
    expect(sectionTitled({ ...facts, documents: facts.documents.filter((d) => d !== sitePhoto) }, "Site evidence")).toBeUndefined();
  });

  it("prints nothing of a file whose field no Screen of the item and no Form field names", () => {
    const stray = replyDoc("stray.jpg", "image/jpeg", "stray-1", "nowhere");
    const facts = { ...withEvidence("en"), documents: [...withEvidence("en").documents, stray] };
    const xml = recordDataXml(recordDataOf(facts, verification));
    expect(xml).not.toContain("stray.jpg");
    expect(printedPhotosOf(facts).map((d) => d.storageKey)).not.toContain("stray-1");
  });
});
