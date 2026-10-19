import {
  checklistSummary,
  checklistSummaryText,
  formatFormValue,
  formatTableCell,
  formSchema,
  isAnswerField,
  type ChecklistField,
  type Locale,
  type TableField,
} from "@rabaed/domain";
import { pick, type RecordLanguage, type RecordText } from "./record-text.ts";

// What a Member wrote in a Transition's Action Form, as its Signature card prints it
// (form-engine.md §6, element 12): each answered field by its label, in the Action Form's
// order; a table (Code B's Comments, recommendations) as a numbered list of its rows. Only
// the answers the facts give, which are a shared event's shared fields (V5, V7).

export type CardLine =
  | { readonly kind: "text"; readonly label: RecordText; readonly value: RecordText }
  | { readonly kind: "list"; readonly label: RecordText; readonly items: readonly RecordText[] };

function perLanguage(language: RecordLanguage, fn: (locale: Locale) => string): RecordText {
  return language === "ar" ? { ar: fn("ar") } : language === "en" ? { en: fn("en") } : { ar: fn("ar"), en: fn("en") };
}

const isBlank = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** The lines of a card: the answers of `actionForm` (a Form schema's `{sections}`) found in `answers`. */
export function actionAnswerLines(actionForm: unknown, answers: Readonly<Record<string, unknown>> | null, language: RecordLanguage): CardLine[] {
  if (!answers) return [];
  const parsed = formSchema.safeParse(actionForm);
  if (!parsed.success) return [];
  const lines: CardLine[] = [];
  for (const field of parsed.data.sections.flatMap((s) => s.fields)) {
    if (!isAnswerField(field)) continue;
    const value = answers[field.key];
    if (isBlank(value)) continue;
    const label = pick(field.label, language);
    switch (field.type) {
      case "member":
      case "participant":
      case "attachments":
      case "photos":
      case "trade":
      case "location":
      case "scopes":
        continue; // a person is never printed from an answer (ADR 0012); files and Built-in Fields are the item's
      case "table": {
        const table = field as TableField;
        const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
        const items = rows
          .map((row) =>
            perLanguage(language, (l) =>
              table.columns
                .map((c) => formatTableCell(c, row[c.key], l))
                .filter((cell) => cell !== "")
                .join(" — "),
            ),
          )
          .filter((item) => Object.values(item).some((v) => v !== ""));
        if (items.length > 0) lines.push({ kind: "list", label, items });
        continue;
      }
      case "checklist":
        lines.push({ kind: "text", label, value: perLanguage(language, (l) => checklistSummaryText(checklistSummary(field as ChecklistField, value), l)) });
        continue;
      default: {
        const text = perLanguage(language, (l) => formatFormValue(field, value, l));
        if (Object.values(text).some((v) => v !== "")) lines.push({ kind: "text", label, value: text });
      }
    }
  }
  return lines;
}
