"use client";

import {
  calculatedReferences,
  conditionFields,
  defaultMaxLength,
  formatNumber,
  formFields,
  isCalculatedField,
  type FieldError,
  type FormField,
  type FormSchema,
  type FormValue,
  type Locale,
} from "@rabaed/domain";
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

/** The key of the Remarks field a code's Action Form holds (form-engine.md §4 "Remarks"). */
const remarksKey = "remarks";

/** The page's pop-up labels: bold, as the owner's design draws them (RP-1188, rows 35–36). */
const popupLabel = "text-[13.5px] font-bold";

/** The pop-up form's words, from the app's messages: its Internal Note, and the Form engine's. */
export type ActionFormLabels = {
  internalNote: string;
  internalNoteHelp: string;
  form: FormRendererLabels;
  /** The Work Item page's pop-up (RP-1188, gap table rows 35–36). */
  page: {
    /** "Optional": the tag beside an optional field's label. */
    optional: string;
    /** "Required": the pill of a field the Screen requires, with no code to name. */
    required: string;
    /** "Only your Company sees it": the Internal Note's amber line. */
    internalNoteShort: string;
    /** "For ‹Company› only…": the Internal Note's placeholder. */
    internalNotePlaceholder: (company: string) => string;
    /** "Required with Code C": the pill of Remarks the Screen requires. */
    remarksRequired: (code: string) => string;
    /** "‹Company› sees these Remarks with your name as signer." */
    remarksHelp: (company: string) => string;
    /** "Write the Remarks for Code C.": Remarks left empty where they are required. */
    remarksMissing: (code: string) => string;
  };
};

/**
 * The Work Item page's pop-up (RP-1188, gap table rows 35–36): the code the Transition issues, the
 * Company that reads its Remarks (null when they stay with the taker's own Company), and the
 * taker's own Company, which alone reads the Internal Note.
 */
export type ActionFormPage = { code: string | null; remarksReader: string | null; ownCompany: string };

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
  /** On the Work Item page: Remarks and the Internal Note as the owner's design draws them. Absent: the plain pop-up (the Kanban's move). */
  page?: ActionFormPage;
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
  page,
}: ActionFormProps) {
  // On the page, a code's Remarks are drawn here, the pill, help and error the design's; required or
  // not stays the Screen's. Only a plain Remarks textarea no other field's condition reads.
  const remarks = page && schema ? pageRemarks(schema) : null;
  const rest = remarks && schema ? withoutField(schema, remarks.key) : schema;
  return (
    <div className="flex flex-col gap-4">
      {remarks && page && (
        <Field
          id={`${idPrefix}-${remarks.key}`}
          label={remarks.label[locale]}
          labelClassName={popupLabel}
          aside={
            remarks.required ? (
              <span className="rounded-full bg-danger-tint px-2 py-0.5 text-[11.5px] font-semibold text-danger-fg">
                {page.code ? text.page.remarksRequired(page.code) : text.page.required}
              </span>
            ) : (
              <span className="text-[11.5px] font-medium text-muted">{text.page.optional}</span>
            )
          }
          help={page.remarksReader ? text.page.remarksHelp(page.remarksReader) : remarks.help?.[locale]}
          error={remarksError(errors, remarks, page.code, locale, text)}
          errorFirst
        >
          {/* Required or not stays the Screen's; the pill says so in place of the asterisk. */}
          <Textarea
            name={remarks.key}
            rows={4}
            required={remarks.required}
            maxLength={remarks.maxLength}
            value={typeof answers[remarks.key] === "string" ? (answers[remarks.key] as string) : ""}
            onChange={(e) => onChange({ [remarks.key]: e.target.value === "" ? undefined : e.target.value })}
            className="aria-invalid:bg-danger-tint"
          />
        </Field>
      )}
      {rest && rest.sections.length > 0 && (
        <FormRenderer
          schema={rest}
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
        id={`${idPrefix}-internal-note`}
        label={text.internalNote}
        // Amber, with a lock: it stays inside the taker's own Company, whoever the Transition goes to (V5). On the page,
        // the design's Optional tag, the short line above the box and a placeholder naming the Company (RP-1188 row 36).
        {...(page
          ? {
              labelClassName: popupLabel,
              aside: <span className="text-[11.5px] font-medium text-muted">{text.page.optional}</span>,
              banner: (
                <span className="flex items-center gap-1.5 rounded-[8px] bg-warning-tint px-2.5 py-2 text-[12.5px] font-semibold text-warning-fg">
                  <Icon name="lock" size={14} className="shrink-0" />
                  {text.page.internalNoteShort}
                </span>
              ),
            }
          : {
              help: (
                <span className="flex items-start gap-1.5 rounded-[8px] bg-warning-tint px-2.5 py-1.5 font-semibold text-warning-fg">
                  <Icon name="lock" size={14} className="mt-0.5 shrink-0" />
                  {text.internalNoteHelp}
                </span>
              ),
            })}
      >
        <Textarea
          name="internalNote"
          rows={3}
          maxLength={internalNoteMaxLength}
          {...(page ? { placeholder: text.page.internalNotePlaceholder(page.ownCompany) } : {})}
          value={internalNote}
          onChange={(e) => onInternalNoteChange(e.target.value)}
        />
      </Field>
    </div>
  );
}

type RemarksField = Extract<ReturnType<typeof formFields>[number], { type: "textarea" }> & { required: boolean };

/** The Action Form's Remarks, when they are a plain textarea that no other field's condition reads; else null. */
function pageRemarks(schema: FormSchema): RemarksField | null {
  const fields = formFields(schema);
  const field = fields.find((f) => f.key === remarksKey);
  if (!field || field.type !== "textarea" || field.visible_if !== undefined || typeof field.required !== "boolean") return null;
  if (fields.some((f) => f !== field && fieldsRead(f).includes(remarksKey))) return null;
  return { ...field, required: field.required };
}

/** The schema without the field `key`, and without a section it leaves empty. */
function withoutField(schema: FormSchema, key: string): FormSchema {
  return {
    ...schema,
    sections: schema.sections
      .map((s) => ({ ...s, fields: s.fields.filter((f) => f.key !== key) }))
      .filter((s) => s.fields.length > 0),
  };
}

/** The design's error for Remarks left empty; any other error in the Form engine's words. */
function remarksError(errors: readonly FieldError[] | undefined, field: RemarksField, code: string | null, locale: Locale, text: ActionFormLabels): string | undefined {
  const error = errors?.find((e) => e.key === field.key);
  if (!error) return undefined;
  if (error.code === "required") return code ? text.page.remarksMissing(code) : text.form.required;
  return error.code === "too_long" ? text.form.tooLong(formatNumber(field.maxLength ?? defaultMaxLength.textarea, locale)) : text.form.wrongType;
}


/** The field keys a field reads: its show-if and required-if conditions, and a calculated field's formula. */
function fieldsRead(field: FormField): string[] {
  return [
    ...("visible_if" in field && field.visible_if ? conditionFields(field.visible_if) : []),
    ...("required" in field && typeof field.required === "object" ? conditionFields(field.required) : []),
    ...(isCalculatedField(field) ? calculatedReferences(field).map((r) => r.key) : []),
  ];
}
