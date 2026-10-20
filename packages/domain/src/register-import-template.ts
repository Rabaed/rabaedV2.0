import type { RegisterFieldId } from "./register-import.ts";
import type { XlsxSheet } from "./xlsx.ts";

// RP-954: the Upload step's "Download template" and "Use sample register", built in the browser
// in the reader's language with writeXlsx (no document properties, every zip entry dated
// 1980-01-01: no time in either). The words come from the app's `registerImport` messages
// (`t`, keyed as in apps/web/messages), so Rabaed Admin's wizard, the customer app's and the
// tests make the same files.

/** A `registerImport` message by its key. */
type Words = (key: string) => string;

/** The template's columns, in order: Rabaed's fields a register fills, besides a Type's Form fields. */
export const registerTemplateFields = ["subject", "type", "trade", "scopes", "location", "package", "assignTo", "paperRef"] as const satisfies readonly RegisterFieldId[];
export type RegisterTemplateField = (typeof registerTemplateFields)[number];

/** The template's words in the reader's language: each column's heading, the two worksheets' names, and the help. */
export type RegisterTemplateWords = {
  headings: Record<RegisterTemplateField, string>;
  sheet: string;
  helpSheet: string;
  /** One a row, under the help worksheet's name as its heading. */
  help: string[];
};

/** The template's words from the `registerImport` messages. */
export const registerTemplateWords = (t: Words): RegisterTemplateWords => ({
  headings: Object.fromEntries(registerTemplateFields.map((f) => [f, t(`fields.${f}`)])) as RegisterTemplateWords["headings"],
  sheet: t("template.sheet"),
  helpSheet: t("template.helpSheet"),
  help: [t("template.asText"), t("template.headerRow"), t("template.values")],
});

/**
 * The template's sheets: the register, its header row only, every column set to text (so a
 * reference number typed in it keeps its zeros: cells are read as stored, RP-635); then the
 * help, a worksheet of its own, so the register's row 1 stays its header row and the import
 * reads it as it opens, with nothing to skip. No Project data in either. Written with
 * `writeXlsx(...registerTemplateSheets(…))`.
 */
export function registerTemplateSheets(words: RegisterTemplateWords, rightToLeft: boolean): [XlsxSheet, XlsxSheet] {
  return [
    { name: words.sheet, rows: [registerTemplateFields.map((f) => words.headings[f])], rightToLeft, textColumns: registerTemplateFields.length },
    { name: words.helpSheet, rows: [[words.helpSheet], ...words.help.map((line) => [line])], rightToLeft },
  ];
}

/** The sample register's words: its worksheet's name, its three columns' headings, and its made-up Subjects. */
export type RegisterSampleWords = {
  sheet: string;
  headings: Record<"subject" | "type" | "trade", string>;
  subjects: string[];
};

/** The made-up Subjects of the sample register, by message key (`sample.s1` …). */
const sampleSubjects = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"] as const;

/** The sample register's words from the `registerImport` messages. */
export const registerSampleWords = (t: Words): RegisterSampleWords => ({
  sheet: t("sample.sheet"),
  headings: { subject: t("fields.subject"), type: t("fields.type"), trade: t("fields.trade") },
  subjects: sampleSubjects.map((key) => t(`sample.${key}`)),
});

/**
 * The sample register (RP-954): a made-up register to try the wizard with. Each made-up Subject
 * takes, in turn, one of `types` (the codes of the Types the importer may raise) and one of
 * `trades` (the names of Trades they may raise in), so every row matches and none is outside
 * their Visibility; both must be non-empty. Nothing comes of it until the importer confirms,
 * like any register.
 */
export function registerSampleSheet(words: RegisterSampleWords, types: readonly string[], trades: readonly string[], rightToLeft: boolean): XlsxSheet {
  const rows = words.subjects.map((subject, i) => [subject, types[i % types.length]!, trades[i % trades.length]!]);
  return { name: words.sheet, rows: [[words.headings.subject, words.headings.type, words.headings.trade], ...rows], rightToLeft };
}
