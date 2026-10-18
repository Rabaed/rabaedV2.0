import type { BilingualText, RecordLanguage } from "@rabaed/domain";

// Text in the record's language (ADR 0023, form-engine.md §5): with record
// language `bilingual` both Arabic and English, with `ar` or `en` only that one.
// The Record Data holds exactly what the pages print, so a single-language
// record never carries the other language.

export type { RecordLanguage };

/** Text in the languages the record prints: at least one is set. */
export interface RecordText {
  readonly ar?: string;
  readonly en?: string;
}

/** `text` in the record's languages. */
export function pick(text: BilingualText, language: RecordLanguage): RecordText {
  return language === "ar" ? { ar: text.ar } : language === "en" ? { en: text.en } : { ar: text.ar, en: text.en };
}

/** Text that is the same in every language (a typed value), in the record's. */
export function same(text: string, language: RecordLanguage): RecordText {
  return pick({ ar: text, en: text }, language);
}

/** Every language of `text` that is set, Arabic first. */
export function texts(text: RecordText): string[] {
  return [text.ar, text.en].filter((t): t is string => t !== undefined);
}
