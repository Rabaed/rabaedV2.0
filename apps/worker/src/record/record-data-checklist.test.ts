import type { RecordFacts } from "@rabaed/db";
import { describe, expect, it } from "vitest";
import { fallbackFonts } from "./fonts.ts";
import type { RecordBlock } from "./form-content.ts";
import { fixtureImages, goldenFacts } from "./golden-fixtures.ts";
import { recordHtml } from "./layout.ts";
import { parseRecordData } from "./record-data-read.ts";
import { recordDataOf, recordDataXml, recordOf } from "./record-data.ts";

// A reply checklist frozen at the code (RP-982; form-engine.md §3.3 and §6, element 8): the Record
// prints the checklist a Transition on the path took into its shared event like any Form
// checklist, right after the Form field whose copy it answers, with each item's "Raise a Snag"
// line. Only a shared event's answers are in the facts (V19): never one the Consultant kept.

const verification = { code: "7K2M-9QXD", link: "https://rabaed.test/verify/x" };
const wir = goldenFacts("wir", "en");

type Checklist = Extract<RecordBlock, { kind: "checklist" }>;
const blocksOf = (facts: RecordFacts) => recordDataOf(facts, verification).sections.flatMap((s) => s.blocks);
const checklistOf = (facts: RecordFacts): Checklist | undefined => blocksOf(facts).find((b): b is Checklist => b.kind === "checklist");
const closing = wir.transitions.at(-1)!;
const withClosing = (change: Partial<typeof closing>): RecordFacts => ({ ...wir, transitions: [...wir.transitions.slice(0, -1), { ...closing, ...change }] });

describe("a reply checklist on the record", () => {
  it("prints after the Checklist Template field it answers, named by the copy, with the summary", () => {
    const section = recordDataOf(wir, verification).sections.find((s) => s.title.en === "Checklist")!;
    expect(section.blocks.map((b) => b.kind)).toEqual(["field", "checklist"]);
    expect(section.blocks[0]).toEqual({ kind: "field", label: { en: "Checklist Template" }, value: { en: "Slab pour" } });
    expect(section.blocks[1]).toMatchObject({ kind: "checklist", label: { en: "Checklist" }, summary: { en: "2 Fail / 1 No" } });
  });

  it("prints each item's text, answer, comment, Snag line and photos, as the code took them", () => {
    const checklist = checklistOf(wir)!;
    expect(checklist.items.map((i) => [i.text.en, i.answer.en, i.comment, i.snag?.en ?? null, i.photos.map((p) => p.fileName)])).toEqual([
      ["Formwork tight", "Fail", "Gap at the joint between panels 4 and 5", "A Snag is raised with the code", ["formwork.jpg", "formwork-annotated.jpg"]],
      ["Rebar cover as per drawing", "Fail", "Cover 15 mm at the slab edge", "No Snag is raised", ["cover.jpg"]],
      ["Clean of debris", "No", null, null, []],
    ]);
  });

  it("is in each language the record prints", () => {
    const bilingual = checklistOf(goldenFacts("wir", "bilingual"))!;
    expect(bilingual.summary.ar).toBeTruthy();
    expect(bilingual.items[0]!.snag).toEqual({ ar: "يُنشأ عيب مع الرمز", en: "A Snag is raised with the code" });
    expect(checklistOf(goldenFacts("wir", "ar"))!.items[1]!.snag).toEqual({ ar: "لا يُنشأ عيب" });
  });

  it("prints nothing a Transition's event did not share: no answers in the facts, no checklist", () => {
    expect(checklistOf(withClosing({ answers: null }))).toBeUndefined();
  });

  it("prints nothing from a Transition off the path, such as a code the Owner sent back", () => {
    const sentBack = { ...closing, kind: "send_back", fromStepId: "owner", toStepId: closing.fromStepId, outcomeMode: null, answers: null };
    const reissued = { ...closing, answers: { remarks: "Issued again, with no checklist" } };
    const facts = { ...wir, transitions: [...wir.transitions.slice(0, -1), { ...closing, kind: "send", toStepId: "owner" }, sentBack, reissued] };
    expect(checklistOf(facts)).toBeUndefined();
    expect(checklistOf(wir)).toBeDefined();
  });

  it("prints nothing for a checklist whose copy the item does not hold", () => {
    expect(checklistOf({ ...wir, checklistCopies: [] })).toBeUndefined();
  });

  it("is a section of its own, under its Screen's title, when the Form doesn't show the field it answers", () => {
    const sections = recordDataOf({ ...wir, form: { ...wir.form, sections: (wir.form.sections as { key: string }[]).filter((s) => s.key !== "checklist") } }, verification).sections;
    expect(sections.map((s) => [s.title.en, s.blocks.map((b) => b.kind)])).toEqual([
      ["Work to inspect", ["field", "field"]],
      ["Checklist", ["checklist"]],
    ]);
  });

  it("prints the fingerprint of a photo it has no image of (past the inline limits), and only of that one", () => {
    const fingerprints = new Map([
      ["photo-1", "a".repeat(64)],
      ["photo-3", "c".repeat(64)],
    ]);
    const { data, images } = recordOf(goldenFacts("wir", "en"), verification, new Map(), () => true, fingerprints);
    // photo-1 inlined; photo-3 (cover.jpg) not: no image, so its fingerprint is printed beside its name.
    const html = recordHtml(data, fallbackFonts(), new Map([["photo-1", fixtureImages.get("photo-1")!]]), images);
    expect(html).toContain("c".repeat(64));
    expect(html).not.toContain("a".repeat(64));
  });

  it("writes the Snag line into the Record Data, and reads it back", () => {
    const data = recordDataOf(goldenFacts("wir", "bilingual"), verification);
    const xml = recordDataXml(data);
    expect(xml).toContain('<snag lang="en">A Snag is raised with the code</snag>');
    expect(xml).toContain('<snag lang="ar">لا يُنشأ عيب</snag>');
    expect(recordDataXml(parseRecordData(xml))).toBe(xml);
  });
});
