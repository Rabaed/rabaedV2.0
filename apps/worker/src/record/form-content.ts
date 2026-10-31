import type { ChecklistCopyFact, DocumentFact, RecordFacts, TransitionFact } from "@rabaed/db";
import {
  buildOptionLists,
  checklistAnswerLabels,
  checklistSummary,
  checklistSummaryText,
  checklistTemplateItem,
  replyChecklistOf,
  snagTickLabels,
  formatFormValue,
  formatTableCell,
  formSchema,
  formVisibility,
  isAnswerField,
  snagTick,
  tableTotals,
  type ChecklistAnswers,
  type ChecklistField,
  type ChecklistTemplateChoice,
  type FormField,
  type FormSection,
  type Locale,
  type OptionList,
  type SupplierChoice,
  type TableField,
} from "@rabaed/domain";
import { z } from "zod";
import { pick, same, type RecordLanguage, type RecordText } from "./record-text.ts";

// The Form's content as the record prints it (form-engine.md §6, element 8): its
// sections in Form Version order, plain fields as a label and value, tables as
// tables, checklists with their summary, photos with when they were taken. Built
// from the answers as every reader of the closed item reads them (the facts), so
// nothing here is one Company's alone.
//
// A reply Screen's checklist (RP-86) is printed as one of the Form's checklists
// (RP-982): the answers a Transition on the path took into its shared event (the
// facts give no other), on the item's copy of the Checklist Template, right after
// the Form field that copied it, with its photos the code froze.
//
// A reply Screen's own files (ADR 0024; RP-1029): its `attachments` files are listed with the
// shared Documents and get appendix pages; its `photos` files print as a Form `photos` field's,
// after the Form, under their Screen section's title. Only files a shared event took before the
// close are in the facts (app.documents_shared_before_close); an internal event's never are.

export interface RecordPhoto {
  readonly fileName: string;
  /** When it was taken (ISO 8601, UTC), from its EXIF. */
  readonly takenAt: string | null;
  /** Where the image is stored: found by the job, never part of the Record Data. */
  readonly storageKey: string;
  /** The SHA-256 (hex) of the image the page prints, when the job inlined it (RP-155: how a Re-produce finds it again); null otherwise. */
  readonly sha256: string | null;
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
        /** Whether the failed item raised a Snag with the code (RP-577); null where it offers none. */
        readonly snag: RecordText | null;
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
    .map((d) => ({ fileName: d.fileName, takenAt: d.takenAt, storageKey: d.storageKey, sha256: null }));
}

/** Whether a Document is listed with the shared Documents rather than shown as a photo of the Form. */
export function isListedDocument(document: DocumentFact, attachmentFieldKeys: ReadonlySet<string>): boolean {
  return document.itemKey === null && (document.fieldKey === null || attachmentFieldKeys.has(document.fieldKey));
}

/** The keys of the Form's fields of `type`, or of every type. */
function fieldKeysOf(facts: Pick<RecordFacts, "form">, type?: FormField["type"]): Set<string> {
  const schema = formSchema.parse({ sections: facts.form.sections });
  return new Set(schema.sections.flatMap((s) => s.fields.filter((f) => type === undefined || f.type === type).map((f) => f.key)));
}

/** A reply Screen's file field (ADR 0024) and its Screen section. */
interface ReplyFileField {
  readonly field: FormField;
  readonly section: FormSection;
}

/**
 * The `attachments` and `photos` fields of the item's reply Screens (the Action Forms of its
 * Transitions), by key, in the Transitions' order; the first one's where two show the same Screen.
 * Which files they hold is the facts' to say: only those a shared event took before the close
 * (app.documents_shared_before_close, V19). A Screen's file field never uses a key of the Form's.
 */
function replyFileFields(transitions: readonly TransitionFact[], formKeys: ReadonlySet<string>): Map<string, ReplyFileField> {
  const fields = new Map<string, ReplyFileField>();
  for (const t of transitions) {
    const screen = formSchema.safeParse(t.actionForm);
    if (!screen.success) continue;
    for (const section of screen.data.sections) {
      for (const field of section.fields) {
        if ((field.type !== "attachments" && field.type !== "photos") || formKeys.has(field.key) || fields.has(field.key)) continue;
        fields.set(field.key, { field, section });
      }
    }
  }
  return fields;
}

/** What the record reads of the item: its Form, and its Transitions where it has them (a Working Copy has none). */
export type FormAndScreens = Pick<RecordFacts, "form"> & Partial<Pick<RecordFacts, "transitions">>;

/** The reply Screens' file fields of `type`, by key. */
function replyFieldsOf(facts: FormAndScreens, type: "attachments" | "photos"): Map<string, ReplyFileField> {
  return new Map([...replyFileFields(facts.transitions ?? [], fieldKeysOf(facts))].filter(([, f]) => f.field.type === type));
}

/**
 * The keys of the Form's `attachments` fields, then the reply Screens' (RP-1029): their files are
 * listed with the shared Documents and get appendix pages.
 */
export const attachmentFieldKeysOf = (facts: FormAndScreens): Set<string> =>
  new Set([...fieldKeysOf(facts, "attachments"), ...replyFieldsOf(facts, "attachments").keys()]);

/**
 * The Documents the record prints as photos, in the order they were added: a check item's (a Form
 * checklist's or a reply checklist's, RP-982), a Form `photos` field's and a reply Screen's
 * `photos` field's (RP-1029).
 */
export function printedPhotosOf(facts: FormAndScreens & Pick<RecordFacts, "documents">): DocumentFact[] {
  const photoFields = new Set([...fieldKeysOf(facts, "photos"), ...replyFieldsOf(facts, "photos").keys()]);
  return facts.documents.filter((d) => d.itemKey !== null || (d.fieldKey !== null && photoFields.has(d.fieldKey)));
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

/** A field's label in the record's languages; a field with none has an empty one. */
const labelOf = (field: FormField, language: RecordLanguage): RecordText => ("label" in field ? pick(field.label, language) : same("", language));

/** A checklist's block: its summary, then each item's text, answer, comment, Snag line and photos (field `checklist.key`'s Documents). */
function checklistBlock(checklist: ChecklistField, value: unknown, documents: readonly DocumentFact[], language: RecordLanguage): RecordBlock {
  const entry = (isChecklist(value) ? value : {}) as ChecklistAnswers;
  return {
    kind: "checklist",
    label: labelOf(checklist, language),
    summary: perLanguage(language, (l) => checklistSummaryText(checklistSummary(checklist, value), l)),
    items: checklist.items.map((item) => {
      const tick = snagTick(item, entry[item.key]);
      return {
        text: pick(item.text, language),
        answer: perLanguage(language, (l) => {
          const answer = entry[item.key]?.answer;
          return answer ? ((checklistAnswerLabels[l] as Record<string, string>)[answer] ?? answer) : none;
        }),
        comment: entry[item.key]?.comment ?? null,
        snag: tick === null ? null : perLanguage(language, (l) => snagTickLabels[l][tick]),
        photos: photosOf(documents, checklist.key, item.key),
      };
    }),
  };
}

/** A reply checklist a Transition on the path took (RP-86): its block, the Form field whose copy it answers, and its Screen section's title. */
interface ReplyChecklist {
  readonly copyOf: string;
  readonly title: RecordText;
  readonly block: RecordBlock;
}

/**
 * The reply checklists the Transitions of `path` took into their shared events, each on the
 * item's copy its field answers. A Transition whose event isn't shared has no answers in the
 * facts, so the Consultant's own work (a Recommended Code, an Internal Note, answers before the
 * code) is never here; neither is a checklist whose copy the item doesn't hold.
 */
function replyChecklists(
  path: readonly TransitionFact[],
  copies: readonly ChecklistCopyFact[],
  documents: readonly DocumentFact[],
  language: RecordLanguage,
): ReplyChecklist[] {
  return path.flatMap((t) => {
    const answers = t.answers;
    const screen = answers ? formSchema.safeParse(t.actionForm) : null;
    if (!answers || !screen?.success) return [];
    return screen.data.sections.flatMap((section) =>
      section.fields.flatMap((field) => {
        if (field.type !== "copied_checklist" || !isChecklist(answers[field.key])) return [];
        const items = z.array(checklistTemplateItem).safeParse(copies.find((c) => c.fieldKey === field.copyOf)?.items);
        if (!items.success) return [];
        // As the api checks it, on the copy's items.
        const checklist = replyChecklistOf(field, { items: items.data });
        return [{ copyOf: field.copyOf, title: pick(section.title, language), block: checklistBlock(checklist, answers[field.key], documents, language) }];
      }),
    );
  });
}

/**
 * The Form's sections as the record prints them, and the blocks of its Classification section.
 * With the Transitions of the path (recordPath), the reply checklists they took print too, each
 * after the Form field whose copy it answers, or, when the Form shows none, in a section of its own.
 */
export function formContent(
  facts: FormAndScreens & Pick<RecordFacts, "documents"> & Partial<Pick<RecordFacts, "checklistCopies">>,
  language: RecordLanguage,
  path: readonly TransitionFact[] = [],
): { sections: RecordSection[]; classification: RecordBlock[]; attachmentFieldKeys: Set<string> } {
  const schema = formSchema.parse({ sections: facts.form.sections });
  const shown = formVisibility(schema, camelLinks(facts.form.answers));
  const answers = shown.answers;
  const lists: OptionList[] = buildOptionLists(
    facts.form.optionLists.map((l) => ({ id: l.id, name: l.name })),
    facts.form.options.map((o) => ({ id: o.id, option_list_id: o.optionListId, parent_id: o.parentId, value: o.value, label: o.label, retired: o.retired })),
  );
  const suppliers: SupplierChoice[] = facts.form.suppliers.map((s) => ({ id: s.id, tradeId: "", status: "approved", name: s.name }));
  const copies = facts.checklistCopies ?? [];
  // A `checklist_template` answer is the Version copied: the copy names it.
  const templates: ChecklistTemplateChoice[] = copies.map((c) => ({ id: c.versionId, tradeId: "", offered: false, name: c.name }));
  const attachmentFieldKeys = attachmentFieldKeysOf(facts);
  const replies = replyChecklists(path, copies, facts.documents, language);

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
        return photos.length === 0 ? null : { kind: "photos", label: labelOf(field, language), photos };
      }
      case "checklist":
        return checklistBlock(field as ChecklistField, value, facts.documents, language);
      case "table": {
        const table = field as TableField;
        const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
        if (rows.length === 0) return null;
        const totals = tableTotals(table, rows);
        return {
          kind: "table",
          label: labelOf(field, language),
          columns: table.columns.map((c) => pick(c.label, language)),
          rows: rows.map((row) => table.columns.map((c) => perLanguage(language, (l) => formatTableCell(c, row[c.key], l, lists) || none))),
          totals: table.columns.some((c) => totals[c.key] !== undefined)
            ? table.columns.map((c) => perLanguage(language, (l) => (totals[c.key] === undefined ? "" : formatTableCell(c, totals[c.key], l, lists))))
            : null,
        };
      }
      default: {
        if (isBlank(value)) return { kind: "field", label: labelOf(field, language), value: same(none, language) };
        const named =
          field.type === "participant" && typeof value === "string" && facts.form.companyNames[value]
            ? { companyName: facts.form.companyNames[value], memberName: null }
            : undefined;
        return {
          kind: "field",
          label: labelOf(field, language),
          value: perLanguage(language, (l) => formatFormValue(field, value, l, named, lists, {}, suppliers, templates) || none),
        };
      }
    }
  }

  const classification: RecordBlock[] = [];
  const sections: RecordSection[] = [];
  const placed = new Set<ReplyChecklist>();
  for (const section of schema.sections) {
    if (!shown.sections.has(section.key)) continue;
    const blocks = section.fields.flatMap((f) => {
      const block = blockOf(f);
      if (!block) return [];
      // The reply checklists answering this field's copy follow it.
      const answering = f.type === "checklist_template" ? replies.filter((r) => r.copyOf === f.key) : [];
      answering.forEach((r) => placed.add(r));
      return [block, ...answering.map((r) => r.block)];
    });
    if (section.key === CLASSIFICATION_SECTION) classification.push(...blocks);
    else if (blocks.length > 0) sections.push({ title: pick(section.title, language), blocks });
  }
  for (const r of replies) if (!placed.has(r)) sections.push({ title: r.title, blocks: [r.block] });
  // A reply Screen's photos (RP-1029) print as a Form `photos` field's do, after the Form, under
  // their Screen section's title: one section for each Screen section that took any.
  const replyPhotoSections = new Map<FormSection, RecordBlock[]>();
  for (const [key, { field, section }] of replyFieldsOf(facts, "photos")) {
    const photos = photosOf(facts.documents, key, null);
    if (photos.length === 0) continue;
    replyPhotoSections.set(section, [...(replyPhotoSections.get(section) ?? []), { kind: "photos", label: labelOf(field, language), photos }]);
  }
  for (const [section, blocks] of replyPhotoSections) sections.push({ title: pick(section.title, language), blocks });
  return { sections, classification, attachmentFieldKeys };
}

const isChecklist = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
