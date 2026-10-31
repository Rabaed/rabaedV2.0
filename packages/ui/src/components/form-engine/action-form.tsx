"use client";

import type { FieldError, FormSchema, FormValue, Locale } from "@rabaed/domain";
import { Field } from "../form/field.tsx";
import { Textarea } from "../form/textarea.tsx";
import { Icon } from "../icon/icon.tsx";
import { FormRenderer, type FormFiles, type FormRendererLabels } from "./form-renderer.tsx";

// A Transition's pop-up (RP-300; form-engine.md §4 "Settled 2026-10-05 (part 3)"):
// its Action Form, a Form schema drawn by the Form engine's renderer, then the
// Internal Note. The Internal Note is not a schema field: it is fixed under every
// Action Form, as System Fields frame a Form, and only the writer's Company sees
// it, even when the Transition goes to another (visibility.md V5). Presentational:
// the page checks the answers (validateAnswers) and sends them.

/** The longest Internal Note the API takes. */
export const internalNoteMaxLength = 4000;

/** The pop-up form's words, from the app's messages: its Internal Note, and the Form engine's. */
export type ActionFormLabels = {
  internalNote: string;
  internalNoteHelp: string;
  form: FormRendererLabels;
};

export type ActionFormProps = {
  labels: ActionFormLabels;
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
  /**
   * The files of a Screen's `photos` and `attachments` fields (ADR 0024): Documents the
   * holding Participant added for this reply, which the Transition takes. Absent: none.
   */
  files?: FormFiles;
};

export function ActionForm({
  schema,
  answers,
  errors,
  labels: text,
  internalNote,
  locale,
  onChange,
  onInternalNoteChange,
  idPrefix = "action-form",
  files,
}: ActionFormProps) {
  return (
    <div className="flex flex-col gap-4">
      {schema && (
        <FormRenderer
          schema={schema}
          answers={answers}
          errors={errors}
          mode="edit"
          locale={locale}
          labels={text.form}
          onChange={onChange}
          idPrefix={idPrefix}
          sectionTitles="hidden"
          className="gap-4"
          {...(files ? { files } : {})}
        />
      )}
      <Field
        label={text.internalNote}
        // Amber, with a lock: it stays inside the taker's own Company, whoever the Transition goes to (V5; RP-1151 row 36).
        help={
          <span className="flex items-start gap-1.5 rounded-[8px] bg-warning-tint px-2.5 py-1.5 font-semibold text-warning-fg">
            <Icon name="lock" size={14} className="mt-0.5 shrink-0" />
            {text.internalNoteHelp}
          </span>
        }
        id={`${idPrefix}-internal-note`}
      >
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
