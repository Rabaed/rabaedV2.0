"use client";

import {
  defaultMaxLength,
  formatNumber,
  formFields,
  isBuiltInField,
  scopesFittingTrade,
  type FieldError,
  type FormField,
  type FormSchema,
  type Locale,
} from "@rabaed/domain";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { focusRing } from "../form/control-styles.ts";
import { Field } from "../form/field.tsx";
import { Input } from "../form/input.tsx";
import { Textarea } from "../form/textarea.tsx";
import { Icon } from "../icon/icon.tsx";
import { BuiltInSelect, builtInAnswerLabels, noChoices, ScopesChecklist, type BuiltInChoices } from "./built-in-fields.tsx";

// The Form engine's renderer (form-engine.md §1, §5): draws a Form Version's
// schema with its answers and per-field errors, to fill in (`edit`) or to read
// (`read`). Presentational only: it fetches nothing and checks nothing itself;
// errors come from the shared validator (validateAnswers) or the API's refusal.
// Labels follow the viewer's language; answers are shown exactly as typed.
// The Built-in Fields (Trade, Location, Scopes) sit where the Form places them,
// offering what the page passes in `choices`.

const copy = {
  en: {
    summary: (n: number) => (n === 1 ? "1 field needs your attention:" : `${formatNumber(n, "en")} fields need your attention:`),
    required: "This field is required.",
    wrongType: "This value isn't valid here.",
    tooLong: (max: number) => `Use at most ${formatNumber(max, "en")} characters.`,
    unknownOption: "Choose from the list offered.",
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
    unknownOption: "اختر من القائمة المعروضة.",
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
  /**
   * What the Built-in Fields offer (edit mode), and the names of the chosen
   * values (read mode). Scopes are filtered here by the chosen Trade.
   */
  choices?: BuiltInChoices;
  /**
   * Called as the filler changes the Form (edit mode), with every answer that
   * changed: one field's, or a new Trade's with the Scopes that still fit it.
   */
  onChange?: (changes: Readonly<Record<string, unknown>>) => void;
  /** Prefix for the fields' ids, unique on the page. */
  idPrefix?: string;
  className?: string;
};

function errorText(field: FormField, error: FieldError, locale: Locale): string {
  const text = copy[locale];
  if (error.code === "too_long" && !isBuiltInField(field)) return text.tooLong(field.maxLength ?? defaultMaxLength[field.type]);
  if (error.code === "unknown_option") return text.unknownOption;
  return error.code === "required" ? text.required : text.wrongType;
}

const textOf = (value: unknown) => (typeof value === "string" ? value : "");
const idsOf = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

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
  choices = noChoices,
  onChange,
  idPrefix = "form",
  className,
}: FormRendererProps) {
  const fieldId = (key: string) => `${idPrefix}-${key}`;
  const byKey = new Map(formFields(schema).map((f) => [f.key, f]));
  const errorOf = (key: string) => errors.find((e) => e.key === key);
  // Only errors of fields on this Form can be shown and linked.
  const shown = mode === "edit" ? errors.filter((e) => byKey.has(e.key)) : [];

  function control(field: FormField): ReactNode {
    switch (field.type) {
      case "trade":
        return (
          <BuiltInSelect
            value={textOf(answers.trade)}
            choices={choices.trades}
            locale={locale}
            // A new Trade keeps only the Scopes that fit it.
            onChange={(trade) => onChange?.({ trade, scopes: scopesFittingTrade(idsOf(answers.scopes), trade, choices.scopes) })}
          />
        );
      case "location":
        return (
          <BuiltInSelect
            value={textOf(answers.location)}
            choices={choices.locations}
            locale={locale}
            onChange={(location) => onChange?.({ location })}
          />
        );
      case "scopes":
        return (
          <ScopesChecklist
            chosen={idsOf(answers.scopes)}
            tradeId={textOf(answers.trade)}
            scopes={choices.scopes}
            locale={locale}
            onChange={(scopes) => onChange?.({ scopes })}
          />
        );
      default: {
        const props = {
          name: field.key,
          value: textOf(answers[field.key]),
          maxLength: field.maxLength ?? defaultMaxLength[field.type],
          // Answers keep the filler's own language and direction.
          dir: "auto" as const,
          onChange: (event: { target: { value: string } }) => onChange?.({ [field.key]: event.target.value }),
        };
        return field.type === "textarea" ? <Textarea rows={5} {...props} /> : <Input {...props} />;
      }
    }
  }

  function answer(field: FormField): ReactNode {
    if (isBuiltInField(field)) {
      const labels = builtInAnswerLabels(field.type, answers[field.key], choices);
      if (labels.length === 0) return null;
      return field.type === "scopes" ? (
        <ul className="flex flex-col gap-1">
          {labels.map((label) => (
            <li key={label}>
              <bdi>{label}</bdi>
            </li>
          ))}
        </ul>
      ) : (
        <bdi>{labels[0]}</bdi>
      );
    }
    const value = textOf(answers[field.key]);
    return value ? <bdi>{value}</bdi> : null;
  }

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
                return (
                  <Field
                    key={field.key}
                    id={fieldId(field.key)}
                    label={field.label[locale]}
                    help={field.help?.[locale]}
                    error={error && errorText(field, error, locale)}
                    // Trade and Location always are, whatever the schema says.
                    required={field.type === "trade" || field.type === "location" || field.required}
                    group={field.type === "scopes"}
                  >
                    {control(field)}
                  </Field>
                );
              })
            ) : (
              <dl className="flex flex-col gap-4">
                {section.fields.map((field) => {
                  const shownAnswer = answer(field);
                  return (
                    <div key={field.key} className="flex flex-col gap-1">
                      <dt className="text-sm font-medium text-muted">{field.label[locale]}</dt>
                      {/* The answer keeps its own direction, but lines up with the page's. */}
                      <dd className={cn("text-body", shownAnswer ? "whitespace-pre-wrap text-text" : "text-muted")}>
                        {shownAnswer ?? copy[locale].unanswered}
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
