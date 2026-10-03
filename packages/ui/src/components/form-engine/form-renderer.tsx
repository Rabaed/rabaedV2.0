"use client";

import {
  defaultMaxLength,
  formatFormValue,
  formatNumber,
  formFields,
  isUnanswered,
  fromProjectWallTime,
  toProjectWallTime,
  type FieldError,
  type FormField,
  type FormOption,
  type FormSchema,
  type FormValue,
  type Locale,
} from "@rabaed/domain";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { CheckboxGroup } from "../form/checkbox-group.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Field } from "../form/field.tsx";
import { Input } from "../form/input.tsx";
import { RadioGroup } from "../form/radio-group.tsx";
import { Select } from "../form/select.tsx";
import { Textarea } from "../form/textarea.tsx";
import { Icon } from "../icon/icon.tsx";

// The Form engine's renderer (form-engine.md §1, §5): draws a Form Version's
// schema with its answers and per-field errors, to fill in (`edit`) or to read
// (`read`). Presentational only: it fetches nothing and checks nothing itself;
// errors come from the shared validator (validateAnswers) or the API's refusal.
// Labels follow the viewer's language; text answers are shown exactly as typed,
// dates and times in the viewer's language with Latin digits, and date-times in
// the Project's time zone.

const copy = {
  en: {
    summary: (n: number) => (n === 1 ? "1 field needs your attention:" : `${formatNumber(n, "en")} fields need your attention:`),
    required: "This field is required.",
    wrongType: "This value isn't valid here.",
    tooLong: (max: number) => `Use at most ${formatNumber(max, "en")} characters.`,
    invalidFormat: { date: "Enter a valid date.", time: "Enter a valid time.", datetime: "Enter a valid date and time." },
    unknownOption: "Choose one of the options.",
    choose: "Choose…",
    none: "None",
    unanswered: "Not answered",
  },
  ar: {
    // Arabic counts: one, two (dual), 3–10 (plural), 11 and more (singular accusative).
    summary: (n: number) =>
      n === 1
        ? "حقل واحد يحتاج إلى مراجعتك:"
        : n === 2
          ? "حقلان يحتاجان إلى مراجعتك:"
          : n <= 10
            ? `${formatNumber(n, "ar")} حقول تحتاج إلى مراجعتك:`
            : `${formatNumber(n, "ar")} حقلًا يحتاج إلى مراجعتك:`,
    required: "هذا الحقل مطلوب.",
    wrongType: "هذه القيمة غير صالحة هنا.",
    tooLong: (max: number) => `استخدم ${formatNumber(max, "ar")} حرفًا على الأكثر.`,
    invalidFormat: { date: "أدخل تاريخًا صالحًا.", time: "أدخل وقتًا صالحًا.", datetime: "أدخل تاريخًا ووقتًا صالحين." },
    unknownOption: "اختر أحد الخيارات.",
    choose: "اختر…",
    none: "بدون",
    unanswered: "لم تتم الإجابة",
  },
} satisfies Record<Locale, unknown>;

export type FormRendererProps = {
  /** The pinned Form Version's schema. */
  schema: FormSchema;
  /** The answers by field key. */
  answers: Readonly<Record<string, unknown>>;
  /** Per-field errors; shown under each field and listed, with links, above the Form. */
  errors?: readonly FieldError[];
  /** `edit` to fill in, `read` to show the answers only. */
  mode: "edit" | "read";
  /** The viewer's language: labels, help and messages. */
  locale: Locale;
  /** Called with a field's key and new value as the filler answers (edit mode); `undefined` clears it. */
  onChange?: (key: string, value: FormValue | undefined) => void;
  /** Prefix for the fields' ids, unique on the page. */
  idPrefix?: string;
  className?: string;
};

function errorText(field: FormField, error: FieldError, locale: Locale): string {
  const text = copy[locale];
  switch (error.code) {
    case "required":
      return text.required;
    case "too_long":
      return field.type === "text" || field.type === "textarea"
        ? text.tooLong(field.maxLength ?? defaultMaxLength[field.type])
        : text.wrongType;
    case "invalid_format":
      return field.type === "date" || field.type === "time" || field.type === "datetime"
        ? text.invalidFormat[field.type]
        : text.wrongType;
    case "unknown_option":
      return text.unknownOption;
    default:
      return text.wrongType;
  }
}

const textOf = (value: unknown) => (typeof value === "string" ? value : "");

// A select's "no choice" item: option values are snake_case keys, so this never clashes with one.
const noChoice = "-";

/** A choice field's options as a control takes them, labelled in the viewer's language. */
const optionsOf = (field: { options: FormOption[] }, locale: Locale) =>
  field.options.map((o) => ({ value: o.value, label: o.label[locale] }));

/** One field's control, and whether its Field labels a group (radios, checkboxes) rather than one control. */
function control(
  field: FormField,
  value: unknown,
  locale: Locale,
  change: (value: FormValue | undefined) => void,
): { element: ReactNode; group?: boolean } {
  const text = copy[locale];
  const name = field.key;
  switch (field.type) {
    case "text":
    case "textarea": {
      const props = {
        name,
        value: textOf(value),
        maxLength: field.maxLength ?? defaultMaxLength[field.type],
        // Answers keep the filler's own language and direction.
        dir: "auto" as const,
        onChange: (event: { target: { value: string } }) => change(event.target.value),
      };
      return { element: field.type === "textarea" ? <Textarea rows={5} {...props} /> : <Input {...props} /> };
    }
    case "date":
    case "time":
      return {
        element: <Input type={field.type} name={name} value={textOf(value)} onChange={(e) => change(e.target.value)} />,
      };
    case "datetime":
      // The control shows the Project's wall time; the answer is the UTC instant.
      return {
        element: (
          <Input
            type="datetime-local"
            name={name}
            value={toProjectWallTime(textOf(value))}
            onChange={(e) => change(fromProjectWallTime(e.target.value) || undefined)}
          />
        ),
      };
    case "yes_no":
      return {
        group: true,
        element: (
          <RadioGroup
            name={name}
            options={[
              { value: "yes", label: formatFormValue(field, true, locale) },
              { value: "no", label: formatFormValue(field, false, locale) },
            ]}
            value={value === true ? "yes" : value === false ? "no" : ""}
            onValueChange={(v) => change(v === "yes")}
          />
        ),
      };
    case "select":
      return {
        element: (
          <Select
            name={name}
            placeholder={text.choose}
            // An optional choice can be taken back.
            options={field.required ? optionsOf(field, locale) : [{ value: noChoice, label: text.none }, ...optionsOf(field, locale)]}
            value={textOf(value)}
            onValueChange={(v) => change(v === noChoice ? undefined : v)}
          />
        ),
      };
    case "multi_select":
      return {
        group: true,
        element: (
          <CheckboxGroup
            options={optionsOf(field, locale)}
            value={Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []}
            onValueChange={change}
          />
        ),
      };
  }
}

/**
 * A Form: its sections in order, each with its fields. In edit mode every field
 * is a labelled control with its help and error; in read mode, a list of labels
 * and answers.
 */
export function FormRenderer({
  schema,
  answers,
  errors = [],
  mode,
  locale,
  onChange,
  idPrefix = "form",
  className,
}: FormRendererProps) {
  const fieldId = (key: string) => `${idPrefix}-${key}`;
  const byKey = new Map(formFields(schema).map((f) => [f.key, f]));
  const errorOf = (key: string) => errors.find((e) => e.key === key);
  // Only errors of fields on this Form can be shown and linked.
  const shown = mode === "edit" ? errors.filter((e) => byKey.has(e.key)) : [];

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      {shown.length > 0 && (
        <div role="alert" className="flex flex-col gap-2 rounded-md border border-danger bg-danger-tint p-4 text-body text-text">
          <p className="flex items-center gap-2 font-semibold">
            <Icon name="alert-circle" size={20} className="text-danger" />
            {copy[locale].summary(shown.length)}
          </p>
          <ul className="flex flex-col gap-1 ps-7">
            {shown.map((e) => (
              <li key={e.key}>
                <a href={`#${fieldId(e.key)}`} className={cn("font-medium text-text underline underline-offset-4", focusRing)}>
                  {byKey.get(e.key)!.label[locale]}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {schema.sections.map((section) => {
        const headingId = `${idPrefix}-section-${section.key}`;
        return (
          <section key={section.key} aria-labelledby={headingId} className="flex flex-col gap-4">
            <h3 id={headingId} className="font-display text-h6 font-semibold text-text">
              {section.title[locale]}
            </h3>
            {mode === "edit" ? (
              section.fields.map((field) => {
                const error = errorOf(field.key);
                const { element, group } = control(field, answers[field.key], locale, (value) => onChange?.(field.key, value));
                return (
                  <Field
                    key={field.key}
                    id={fieldId(field.key)}
                    label={field.label[locale]}
                    help={field.help?.[locale]}
                    error={error && errorText(field, error, locale)}
                    required={field.required}
                    group={group}
                  >
                    {element}
                  </Field>
                );
              })
            ) : (
              <dl className="flex flex-col gap-4">
                {section.fields.map((field) => {
                  const value = answers[field.key];
                  return (
                    <div key={field.key} className="flex flex-col gap-1">
                      <dt className="text-sm font-medium text-muted">{field.label[locale]}</dt>
                      {/* The answer keeps its own direction, but lines up with the page's. */}
                      <dd className={cn("text-body", isUnanswered(value) ? "text-muted" : "whitespace-pre-wrap text-text")}>
                        {isUnanswered(value) ? copy[locale].unanswered : <bdi>{formatFormValue(field, value, locale)}</bdi>}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            )}
          </section>
        );
      })}
    </div>
  );
}
