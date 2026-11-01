// The Disclaimer of the seven Rabaed Default Forms (RP-985, replacing RP-650's placeholder;
// form-engine.md §6 element 14): the owner's text, character for character, in the `pdf` block of
// MAR, SAR, DAR, WIR, CMT, QST (which serves the three question Types) and SNG. A published Version
// is immutable, so a change here reaches records only through a new Version (`pnpm defaults:publish`).
import { formSchema } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { rabaedFormFile } from "./rabaed-defaults.ts";

/** The owner's wording (RP-985, comment of 2026-11-01): the English ends in a full stop, the Arabic keeps its diacritics. */
const OWNER_DISCLAIMER = {
  en: "Above inspection shall not relieve Contractor of his responsibilities to incorporate in the Works only such materials that are in conformity with the contract.",
  ar: "لا يُعفي الفحص المذكور أعلاه المقاولَ من مسؤوليته عن ألّا يُدمج في الأعمال إلا المواد المطابقة للعقد.",
};

const FILES = ["MAR.json", "SAR.json", "DAR.json", "WIR.json", "CMT.json", "QST.json", "SNG.json"] as const;

describe("the seven Rabaed Default Forms' Disclaimer", () => {
  it.each(FILES)("%s carries the owner's text in English and Arabic, character for character", (file) => {
    const form = formSchema.parse(rabaedFormFile(file));
    expect(form.pdf?.disclaimer).toEqual(OWNER_DISCLAIMER);
  });

  it.each(FILES)("%s keeps no placeholder, and its review duration stays off", (file) => {
    const form = formSchema.parse(rabaedFormFile(file));
    expect(JSON.stringify(form.pdf)).not.toMatch(/‹|›/);
    expect(form.pdf?.show_review_duration).toBe(false);
  });
});
