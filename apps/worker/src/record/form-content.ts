import type { DocumentFact, RecordFacts } from "@rabaed/db";
import {
  buildOptionLists,
  checklistAnswerLabels,
  checklistSummary,
  checklistSummaryText,
  formatFormValue,
  formatTableCell,
  formSchema,
  formVisibility,
  isAnswerField,
  tableTotals,
  type ChecklistField,
  type FormField,
  type Locale,
  type OptionList,
  type SupplierChoice,
  type TableField,
} from "@rabaed/domain";
import { pick, same, type RecordLanguage, type RecordText } from "./record-text.ts";

// The Form's content as the record prints it (form-engine.md §6, element 8): its
// sections in Form Version order, plain fields as a label and value, tables as
// tables, checklists with their summary, photos with when they were taken. Built
// from the answers as every reader of the closed item reads them (the facts), so
// nothing here is one Company's alone.

export interface RecordPhoto {
  readonly fileName: string;
  /** When it was taken (ISO 8601, UTC), from its EXIF. */
  readonly takenAt: string | null;
  /** Where the image is stored: found by the job, never part of the Record Data. */
  readonly storageKey: string;
}

export type RecordBlock =
  | { readonly kind: "field"; readonly label: RecordText; readonly value: RecordText }
  | {
      readonly kind: "table";
      readonly label: RecordText;
      readonly columns: readonly RecordText[];
      readonly rows: readonly (readonly RecordText[])[];
      /** One cell for each column, empty where the column has no total; null when no column has one. */
      readonly totals: readonly RecordText[] | null;
    }
  | {
      readonly kind: "checklist";
      readonly label: RecordText;
      readonly summary: RecordText;
      readonly items: readonly {
        readonly text: RecordText;
        readonly answer: RecordText;
        readonly comment: string | null;
        readonly photos: readonly RecordPhoto[];
      }[];
    }
  | { readonly kind: "photos"; readonly label: RecordText; readonly photos: readonly RecordPhoto[] };

export interface RecordSection {
  readonly title: RecordText;
  readonly blocks: readonly RecordBlock[];
}

/** The section the Form uses for the Classification box (form-engine.md §6, element 4). */
export const CLASSIFICATION_SECTION = "classification";

const none = "—";

/** What `fn` reads in each language the record prints. */
function perLanguage(language: RecordLanguage, fn: (locale: Locale) => string): RecordText {
  return language === "ar" ? { ar: fn("ar") } : language === "en" ? { en: fn("en") } : { ar: fn("ar"), en: fn("en") };
}

const isBlank = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** The photos of a field (and a checklist item) among the Documents, in the order they were added. */
function photosOf(documents: readonly DocumentFact[], fieldKey: string, itemKey: string | null): RecordPhoto[] {
  return documents
    .filter((d) => d.fieldKey === fieldKey && d.itemKey === itemKey)
    .map((d) => ({ fileName: d.fileName, takenAt: d.takenAt, storageKey: d.storageKey }));
}

/** Whether a Document is listed with the shared Documents rather than shown as a photo of the Form. */
export function isListedDocument(document: DocumentFact, attachmentFieldKeys: ReadonlySet<string>): boolean {
  return document.itemKey === null && (document.fieldKey === null || attachmentFieldKeys.has(document.fieldKey));
}

/** The keys of the Form's `attachments` fields: their files are listed with the shared Documents. */
export function attachmentFieldKeysOf(facts: RecordFacts): Set<string> {
  const schema = formSchema.parse({ sections: facts.form.sections });
  return new Set(schema.sections.flatMap((s) => s.fields.filter((f) => f.type === "attachments").map((f) => f.key)));
}

/** A link question's items as the database gives them (`document_number`) in the shape the display takes (`documentNumber`). */
function camelLinks(answers: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(answers).map(([key, value]) => [
      key,
      Array.isArray(value)
        ? value.map((v) =>
            typeof v === "object" && v !== null && "document_number" in v
              ? { documentNumber: (v as { document_number: string }).document_number, subject: (v as { subject: string }).subject }
              : v,
          )
        : value,
    ]),
  );
}

/** The Form's sections as the record prints them, and the blocks of its Classification section. */
export function formContent(facts: RecordFacts, language: RecordLanguage): { sections: RecordSection[]; classification: RecordBlock[]; attachmentFieldKeys: Set<string> } {
  const schema = formSchema.parse({ sections: facts.form.sections });
  const shown = formVisibility(schema, camelLinks(facts.form.answers));
  const answers = shown.answers;
  const lists: OptionList[] = buildOptionLists(
    facts.form.optionLists.map((l) => ({ id: l.id, name: l.name })),
    facts.form.options.map((o) => ({ id: o.id, option_list_id: o.optionListId, parent_id: o.parentId, value: o.value, label: o.label, retired: o.retired })),
  );
  const suppliers: SupplierChoice[] = facts.form.suppliers.map((s) => ({ id: s.id, tradeId: "", status: "approved", name: s.name }));
  const attachmentFieldKeys = attachmentFieldKeysOf(facts);

  const labelOf = (field: FormField): RecordText => ("label" in field ? pick(field.label, language) : same("", language));

  function blockOf(field: FormField): RecordBlock | null {
    if (!isAnswerField(field) || !shown.fields.has(field.key)) return null;
    const value = answers[field.key];
    switch (field.type) {
      case "trade":
      case "location":
      case "scopes":
        return null; // the Classification box names them
      case "member":
        return null; // never printed: another Company reads a Member's answer as nothing (ADR 0012)
      case "attachments":
        return null; // listed with the Documents
      case "photos": {
        const photos = photosOf(facts.documents, field.key, null);
        return photos.length === 0 ? null : { kind: "photos", label: labelOf(field), photos };
      }
      case "checklist": {
        const entry = (isChecklist(value) ? value : {}) as Record<string, { answer?: string; comment?: string }>;
        const checklist = field as ChecklistField;
        return {
          kind: "checklist",
          label: labelOf(field),
          summary: perLanguage(language, (l) => checklistSummaryText(checklistSummary(checklist, value), l)),
          items: checklist.items.map((item) => ({
            text: pick(item.text, language),
            answer: perLanguage(language, (l) => {
              const answer = entry[item.key]?.answer;
              return answer ? ((checklistAnswerLabels[l] as Record<string, string>)[answer] ?? answer) : none;
            }),
            comment: entry[item.key]?.comment ?? null,
            photos: photosOf(facts.documents, field.key, item.key),
          })),
        };
      }
      case "table": {
        const table = field as TableField;
        const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
        if (rows.length === 0) return null;
        const totals = tableTotals(table, rows);
        return {
          kind: "table",
          label: labelOf(field),
          columns: table.columns.map((c) => pick(c.label, language)),
          rows: rows.map((row) => table.columns.map((c) => perLanguage(language, (l) => formatTableCell(c, row[c.key], l, lists) || none))),
          totals: table.columns.some((c) => totals[c.key] !== undefined)
            ? table.columns.map((c) => perLanguage(language, (l) => (totals[c.key] === undefined ? "" : formatTableCell(c, totals[c.key], l, lists))))
            : null,
        };
      }
      default: {
        if (isBlank(value)) return { kind: "field", label: labelOf(field), value: same(none, language) };
        const named =
          field.type === "participant" && typeof value === "string" && facts.form.companyNames[value]
            ? { companyName: facts.form.companyNames[value], memberName: null }
            : undefined;
        return {
          kind: "field",
          label: labelOf(field),
          value: perLanguage(language, (l) => formatFormValue(field, value, l, named, lists, {}, suppliers) || none),
        };
      }
    }
  }

  const classification: RecordBlock[] = [];
  const sections: RecordSection[] = [];
  for (const section of schema.sections) {
    if (!shown.sections.has(section.key)) continue;
    const blocks = section.fields.flatMap((f) => blockOf(f) ?? []);
    if (section.key === CLASSIFICATION_SECTION) classification.push(...blocks);
    else if (blocks.length > 0) sections.push({ title: pick(section.title, language), blocks });
  }
  return { sections, classification, attachmentFieldKeys };
}

const isChecklist = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
