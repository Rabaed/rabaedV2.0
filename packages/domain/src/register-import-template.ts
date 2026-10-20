import type { RegisterFieldId } from "./register-import.ts";
import { writeXlsx, type XlsxSheet } from "./xlsx.ts";

// RP-954: the Upload step's "Download template" and "Use sample register", built in the browser
// in the reader's language with writeXlsx (no document properties, every zip entry dated
// 1980-01-01: no time in either). The words come from the app's `registerImport` messages, so
// Rabaed Admin's wizard and the customer app's give the same files.

/** The template's columns, in order: Rabaed's fields a register fills, besides a Type's Form fields. */
export const registerTemplateFields = ["subject", "type", "trade", "scopes", "location", "package", "assignTo", "paperRef"] as const satisfies readonly RegisterFieldId[];
export type RegisterTemplateField = (typeof registerTemplateFields)[number];

/** The template's words in the reader's language: each column's heading, the two sheets' names, and the help. */
export type RegisterTemplateWords = {
  headings: Record<RegisterTemplateField, string>;
  sheet: string;
  helpSheet: string;
  /** One a row, under the help sheet's name as its heading. */
  help: string[];
};

/**
 * The template's sheets: the register, its header row only, every column set to text (so a
 * reference number typed in it keeps its zeros: cells are read as stored, RP-635); then the
 * help, a worksheet of its own, so the register's row 1 stays its header row and
 * the import reads it as it opens, with nothing to skip. No Project data in either.
 */
export function registerTemplateSheets(words: RegisterTemplateWords, rightToLeft: boolean): [XlsxSheet, XlsxSheet] {
  return [
    { name: words.sheet, rows: [registerTemplateFields.map((f) => words.headings[f])], rightToLeft, textColumns: registerTemplateFields.length },
    { name: words.helpSheet, rows: [[words.helpSheet], ...words.help.map((line) => [line])], rightToLeft },
  ];
}

/** The template as an .xlsx. */
export const registerTemplateXlsx = (words: RegisterTemplateWords, rightToLeft: boolean): Uint8Array => writeXlsx(...registerTemplateSheets(words, rightToLeft));

/** The sample register's words: its sheet's name, its three columns' headings, and its made-up Subjects. */
export type RegisterSampleWords = {
  sheet: string;
  headings: Record<"subject" | "type" | "trade", string>;
  subjects: string[];
};

/**
 * The sample register (RP-954): a made-up register to try the wizard with. Each made-up Subject
 * takes, in turn, one of `types` (the codes of the Types the importer may raise) and one of
 * `trades` (the names of Trades they may raise in), so every row matches and none is outside their
 * Visibility. Nothing comes of it until the importer confirms, like any register.
 */
export function registerSampleSheet(words: RegisterSampleWords, types: readonly string[], trades: readonly string[], rightToLeft: boolean): XlsxSheet {
  const rows = types.length === 0 || trades.length === 0 ? [] : words.subjects.map((subject, i) => [subject, types[i % types.length]!, trades[i % trades.length]!]);
  return { name: words.sheet, rows: [[words.headings.subject, words.headings.type, words.headings.trade], ...rows], rightToLeft };
}
