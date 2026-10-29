import { describe, expect, it } from "vitest";
import { fallbackFonts } from "./fonts.ts";
import { fixtureImages, goldenRecord } from "./golden-fixtures.ts";
import { recordHtml } from "./layout.ts";

// The record's own words use the glossary's terms (RP-1086): page 1's box of the Companies on the
// item by Project Role is "Participants" (GLOSSARY.md, Project Participant), never "Parties".

const pageOf = (language: "bilingual" | "ar" | "en") => {
  const { data, images } = goldenRecord("A", language);
  return recordHtml(data, fallbackFonts(), fixtureImages, images);
};

describe("the Participants box", () => {
  it("is headed Participants in both languages of a bilingual record", () => {
    const html = pageOf("bilingual");
    expect(html).toContain("Participants");
    expect(html).toContain("المشاركون");
    expect(html).not.toContain("Parties");
    expect(html).not.toContain("الأطراف");
  });

  it("is headed in the record's one language", () => {
    expect(pageOf("en")).toContain("Participants");
    expect(pageOf("ar")).toContain("المشاركون");
  });
});
