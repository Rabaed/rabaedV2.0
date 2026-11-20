import { describe, expect, it } from "vitest";
import { fallbackFonts } from "./fonts.ts";
import { fixtureImages, goldenRecord } from "./golden-fixtures.ts";
import { recordHtml } from "./layout.ts";

// Before its first Submit an item has no Document Number (ADR 0030). A Working Copy of it, or the
// Documental Record of one cancelled in Internal Review, prints "No number yet" in the number's
// place, in the record's languages (RP-1319). A Document Number still prints left to right.

const pageOf = (language: "bilingual" | "ar" | "en", documentNumber: string | null) => {
  const { data, images } = goldenRecord("A", language);
  return recordHtml({ ...data, documentNumber }, fallbackFonts(), fixtureImages, images);
};

/** The title block's number line: the `<dd>` after the Document Number heading. */
const numberLine = (page: string) => /رقم المستند|Document Number/.exec(page) && page.slice(page.indexOf("<dt>", page.indexOf("title-block"))).split("</dl>")[0]!;

describe("an item with no number yet", () => {
  it("prints \"No number yet\" in both languages of a bilingual record, and no dash", () => {
    const page = pageOf("bilingual", null);
    const line = numberLine(page);
    expect(line).toContain("No number yet");
    expect(line).toContain("بلا رقم بعد");
    expect(line).not.toContain("—");
    // The running header and the title read it too.
    expect(page).toMatch(/<title>[^<]*No number yet<\/title>/);
    expect(page).not.toMatch(/content: "[^"]*⁦—⁩/);
  });

  it("prints it in the record's one language", () => {
    expect(numberLine(pageOf("en", null))).toContain("No number yet");
    expect(numberLine(pageOf("en", null))).not.toContain("بلا رقم بعد");
    expect(numberLine(pageOf("ar", null))).toContain("بلا رقم بعد");
    expect(numberLine(pageOf("ar", null))).not.toContain("No number yet");
  });

  it("still prints a Document Number left to right", () => {
    const line = numberLine(pageOf("ar", "TWR-MAR-01-0007"));
    expect(line).toContain('<bdi dir="ltr" class="ltr">TWR-MAR-01-0007</bdi>');
    expect(line).not.toContain("بلا رقم بعد");
  });
});
