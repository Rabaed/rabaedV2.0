"use client";

import type { FieldError, FormSchema, FormValue, Locale } from "@rabaed/domain";
import { Field } from "../form/field.tsx";
import { Textarea } from "../form/textarea.tsx";
import { FormRenderer } from "./form-renderer.tsx";

// A Transition's pop-up (RP-300; form-engine.md §4 "Settled 2026-10-05 (part 3)"):
// its Action Form, a Form schema drawn by the Form engine's renderer, then the
// Internal Note. The Internal Note is not a schema field: it is fixed under every
// Action Form, as System Fields frame a Form, and only the writer's Company sees
// it, even when the Transition goes to another (visibility.md V5). Presentational:
// the page checks the answers (validateAnswers) and sends them.

/** The longest Internal Note the API takes. */
export const internalNoteMaxLength = 4000;

const copy = {
  en: {
    internalNote: "Internal Note",
    internalNoteHelp:
      "Optional. Only your Company sees it, even when the item goes to another Company. Anything for them goes in Chat or the Form.",
  },
  ar: {
    internalNote: "ملاحظة داخلية",
    internalNoteHelp: "اختيارية. لا يراها إلا شركتك، حتى عندما ينتقل العنصر إلى شركة أخرى. ما يخصهم يُكتب في المحادثة أو النموذج.",
  },
} satisfies Record<Locale, unknown>;

export type ActionFormProps = {
  /** The Transition's Action Form; null when it asks nothing but the Internal Note. */
  schema: FormSchema | null;
  /** Its answers so far, by field key. */
  answers: Readonly<Record<string, unknown>>;
  /** Per-field errors, from the validator or the API's `invalid_action_form` refusal. */
  errors?: readonly FieldError[];
  internalNote: string;
  locale: Locale;
  onChange: (changes: Readonly<Record<string, FormValue | undefined>>) => void;
  onInternalNoteChange: (internalNote: string) => void;
  /** Prefix for the fields' ids, unique on the page. */
  idPrefix?: string;
};

export function ActionForm({
  schema,
  answers,
  errors,
  internalNote,
  locale,
  onChange,
  onInternalNoteChange,
  idPrefix = "action-form",
}: ActionFormProps) {
  const text = copy[locale];
  return (
    <div className="flex flex-col gap-4">
      {schema && (
        <FormRenderer
          schema={schema}
          answers={answers}
          errors={errors}
          mode="edit"
          locale={locale}
          onChange={onChange}
          idPrefix={idPrefix}
          sectionTitles="hidden"
          className="gap-4"
        />
      )}
      <Field label={text.internalNote} help={text.internalNoteHelp} id={`${idPrefix}-internal-note`}>
        <Textarea
          name="internalNote"
          rows={3}
          maxLength={internalNoteMaxLength}
          value={internalNote}
          onChange={(e) => onInternalNoteChange(e.target.value)}
        />
      </Field>
    </div>
  );
}
