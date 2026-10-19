import type { WorkingCopyContent } from "@rabaed/db";
import { describe, expect, it } from "vitest";
import { fallbackFonts } from "./fonts.ts";
import { goldenFacts } from "./golden-fixtures.ts";
import { recordHtml } from "./layout.ts";
import { workingCopyDataOf } from "./working-copy.ts";

// The Working Copy (RP-621): the record's one layout, printed from the item as shared, with no
// person, no QR or Verification Code, and the Project's watermark across every page.

/** A Working Copy's content, from the record's golden facts with what only a closed item has taken out. */
function content(language: WorkingCopyContent["recordLanguage"]): WorkingCopyContent {
  const { outcome: _outcome, closedAt: _closedAt, reviewComments: _comments, transitions, ...facts } = goldenFacts("A", language);
  return {
    ...facts,
    recordLanguage: language,
    watermark: { en: "Not Final", ar: "غير نهائي" },
    stage: { en: "Under Review", ar: "قيد المراجعة" },
    moves: transitions.map((t) => ({ kind: t.kind, label: t.label, at: t.at, participantId: t.participantId, companyName: t.companyName, roleName: t.roleName })),
  };
}

const people = (language: WorkingCopyContent["recordLanguage"]) =>
  goldenFacts("A", language).transitions.flatMap((t) => [t.memberName.en, t.memberName.ar]);

describe("a Working Copy's page", () => {
  it("prints the watermark across the page and in the footer, in each language the record prints", async () => {
    const html = recordHtml(workingCopyDataOf(content("bilingual")), await fallbackFonts());
    expect(html).toContain('class="watermark"');
    expect(html).toMatch(/content: "\u2066Not Final · page "/);
    expect(html).toContain("غير نهائي");
    const en = recordHtml(workingCopyDataOf(content("en")), await fallbackFonts());
    expect(en).toContain("Not Final");
    expect(en).not.toContain("غير نهائي");
  });

  it("names no person, prints no QR, Verification Code or content hash, and is not 'Issued electronically'", async () => {
    const html = recordHtml(workingCopyDataOf(content("bilingual")), await fallbackFonts());
    for (const name of people("bilingual")) expect(html, name).not.toContain(name);
    for (const word of ["Verification", "Issued electronically", "Content hash", "Final decision", "Issued by", "<svg class=\"qr", 'class="qr"']) {
      expect(html, word).not.toContain(word);
    }
  });

  it("shows the Stage instead of an outcome, every outcome unissued, and the moves by Company", async () => {
    const data = workingCopyDataOf(content("en"));
    expect(data.chips.every((c) => !c.issued)).toBe(true);
    const html = recordHtml(data, await fallbackFonts());
    expect(html).toContain("Under Review");
    for (const m of data.moves) expect(html).toContain(m.company.en!);
    expect(html).not.toContain("chip issued");
  });

  it("marks a move that gave the item back as returned for revision", () => {
    const moves = workingCopyDataOf({ ...content("en"), moves: [{ ...content("en").moves[0]!, kind: "return" }] }).moves;
    expect(moves.map((m) => m.mark)).toEqual(["revise"]);
  });
});
