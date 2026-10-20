import {
  formatNumber,
  registerSampleSheet,
  registerTemplateFields,
  registerTemplateXlsx,
  writeXlsx,
  xlsxContentType,
  type BilingualText,
  type Locale,
  type RegisterImport,
  type RegisterTemplateWords,
} from "@rabaed/domain";
import type { Translate } from "../workflow/workflow-builder-labels-from.ts";
import { reasonLines } from "./register-import-rows.tsx";

// The Submittal Register Import's downloads (RP-644, story 17): the rejected rows, as the
// register's own columns plus a "Reasons" column, to fix and import again; and the log, every
// bad row with its reasons. Built in the browser from the import as read, in the reader's
// language, with @rabaed/domain writeXlsx: no time anywhere, neither in the file's name nor in
// the workbook (owner, 2026-10-19). And the Upload step's blank template and sample register
// (RP-954), with no Project data and no time either. `t` is the `registerImport` messages.

/** The register's name without its extension: what each download is named after. */
const registerOf = (fileName: string) => fileName.replace(/\.(xlsx|csv)$/i, "");

/** One workbook to save: its name and bytes. */
export type RegisterDownload = { fileName: string; bytes: Uint8Array };

/** The rejected rows: each bad row's cells under the register's own column headings, then its reasons, one a line. */
export function rejectedRowsDownload(imported: RegisterImport, t: Translate, locale: Locale): RegisterDownload {
  const width = imported.headers.length;
  const rows = imported.rows
    .filter((r) => r.reasons.length > 0)
    .map((r) => [...Array.from({ length: width }, (_, c) => r.cells[c] ?? ""), reasonLines(r, imported.mapping, t, locale).map((l) => l.text).join("\n")]);
  return {
    fileName: t("downloads.rejectedFile", { register: registerOf(imported.fileName) }),
    bytes: writeXlsx({ name: t("downloads.rejectedSheet"), rows: [[...imported.headers, t("downloads.reasons")], ...rows], rightToLeft: locale === "ar" }),
  };
}

/** The log: every bad row by its number in the register, its Subject and its reasons. */
export function logDownload(imported: RegisterImport, t: Translate, locale: Locale): RegisterDownload {
  const rows = imported.rows
    .filter((r) => r.reasons.length > 0)
    .map((r) => [formatNumber(r.rowNo, locale), r.subject, reasonLines(r, imported.mapping, t, locale).map((l) => l.text).join("\n")]);
  return {
    fileName: t("downloads.logFile", { register: registerOf(imported.fileName) }),
    bytes: writeXlsx({
      name: t("downloads.logSheet"),
      rows: [[t("downloads.row"), t("downloads.subject"), t("downloads.reasons")], ...rows],
      rightToLeft: locale === "ar",
    }),
  };
}

/** The template's words (RP-954) in the reader's language, from the `registerImport` messages. */
const templateWords = (t: Translate): RegisterTemplateWords => ({
  headings: Object.fromEntries(registerTemplateFields.map((f) => [f, t(`fields.${f}`)])) as RegisterTemplateWords["headings"],
  sheet: t("template.sheet"),
  helpSheet: t("template.helpSheet"),
  help: [t("template.asText"), t("template.headerRow"), t("template.values")],
});

/** The blank register template (RP-954): Rabaed's fields as its header row, its columns set to text, and its help. No Project data. */
export function templateDownload(t: Translate, locale: Locale): RegisterDownload {
  return { fileName: t("template.file"), bytes: registerTemplateXlsx(templateWords(t), locale === "ar") };
}

/** The made-up Subjects of the sample register, by message key. */
const sampleSubjects = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"] as const;

/**
 * The sample register (RP-954), to try the wizard with: the made-up Subjects, each with one of the
 * Types the importer may raise (by code) and one of the Trades offered them (by name, in the
 * reader's language), so every row matches. Read like any register: nothing is created until confirm.
 */
export function sampleRegister(t: Translate, locale: Locale, types: readonly { code: string }[], trades: readonly { name: BilingualText }[]): RegisterDownload {
  const words = {
    sheet: t("sample.sheet"),
    headings: { subject: t("fields.subject"), type: t("fields.type"), trade: t("fields.trade") },
    subjects: sampleSubjects.map((key) => t(`sample.${key}`)),
  };
  const sheet = registerSampleSheet(words, types.map((ty) => ty.code), trades.map((tr) => tr.name[locale]), locale === "ar");
  return { fileName: t("sample.file"), bytes: writeXlsx(sheet) };
}

/** Hands `bytes` to the browser to save as `fileName`. */
export function saveDownload(fileName: string, bytes: Uint8Array | Blob, type = xlsxContentType): void {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as Uint8Array<ArrayBuffer>], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // After the click has handed it over.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
