"use client";

import {
  currencyDecimals,
  defaultMaxLength,
  directionOf,
  formatFormValue,
  formatNumber,
  answerFields,
  intlLocaleOf,
  formVisibility,
  fromProjectWallTime,
  isAnswerField,
  isBuiltInField,
  isRequired,
  isUnanswered,
  parseNumberInput,
  scopesFittingTrade,
  toLatinDigits,
  toProjectWallTime,
  type AnswerField,
  type BuiltInFieldType,
  type FieldError,
  type FormChoices,
  type FormField,
  type LayoutField,
  type FormOption,
  type FormSchema,
  type FormValue,
  type Locale,
  type NamedAnswer,
  type NamedAnswers,
} from "@rabaed/domain";
import { useState, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { CheckboxGroup } from "../form/checkbox-group.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Field } from "../form/field.tsx";
import { Input } from "../form/input.tsx";
import { RadioGroup } from "../form/radio-group.tsx";
import { Select } from "../form/select.tsx";
import { Textarea } from "../form/textarea.tsx";
import { Icon } from "../icon/icon.tsx";
import { BuiltInSelect, builtInAnswerLabels, noChoices, ScopesChecklist, type BuiltInChoices } from "./built-in-fields.tsx";

// The Form engine's renderer (form-engine.md §1, §5): draws a Form Version's
// schema with its answers and per-field errors, to fill in (`edit`) or to read
// (`read`). Presentational only: it fetches nothing and checks nothing itself;
// errors come from the shared validator (validateAnswers) or the API's refusal.
// Labels follow the viewer's language; text answers are shown exactly as typed,
// dates and times in the viewer's language with Latin digits, and date-times in
// the Project's time zone. The Built-in Fields (Trade, Location, Scopes) sit
// where the Form places them, offering what the page passes in `choices`. A
// `member` or `participant` field offers only the `people` the API gave this
// filler, and reads as the API named it for this viewer: another Company's
// Member by the Company's name only (V14). A saved one no longer on offer (a
// Member who left the Project) stays the choice, marked, until changed.

const copy = {
  en: {
    summary: (n: number) => (n === 1 ? "1 field needs your attention:" : `${formatNumber(n, "en")} fields need your attention:`),
    required: "This field is required.",
    wrongType: "This value isn't valid here.",
    tooLong: (max: number) => `Use at most ${formatNumber(max, "en")} characters.`,
    invalidFormat: {
      date: "Enter a valid date.",
      time: "Enter a valid time.",
      datetime: "Enter a valid date and time.",
      email: "Enter a valid email address, such as name@company.com.",
      phone: "Enter a valid phone number, such as 050 123 4567 or +966 50 123 4567.",
    },
    notANumber: "Enter a number.",
    belowMin: (min: string) => `Enter ${min} or more.`,
    aboveMax: (max: string) => `Enter ${max} or less.`,
    tooManyDecimals: (n: number) =>
      n === 0 ? "Enter a whole number." : n === 1 ? "Use at most 1 decimal place." : `Use at most ${formatNumber(n, "en")} decimal places.`,
    unknownOption: "Choose one of the options.",
    choose: "Choose…",
    none: "None",
    // The name sits in an isolate (⁨ first strong, ⁩ ends), so an Arabic name keeps its place.
    leftProject: (name: string) => `⁨${name}⁩ (no longer on the Project)`,
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
    // Latin examples and limits sit in isolates (\u2066 left to right, \u2067 right to left, \u2069 ends), so a + or a unit stays in place.
    invalidFormat: {
      date: "أدخل تاريخًا صالحًا.",
      time: "أدخل وقتًا صالحًا.",
      datetime: "أدخل تاريخًا ووقتًا صالحين.",
      email: "أدخل بريدًا إلكترونيًا صالحًا، مثل \u2066name@company.com\u2069.",
      phone: "أدخل رقم هاتف صالحًا، مثل \u2066050 123 4567\u2069 أو \u2066+966 50 123 4567\u2069.",
    },
    notANumber: "أدخل رقمًا.",
    belowMin: (min: string) => `أدخل \u2067${min}\u2069 أو أكثر.`,
    aboveMax: (max: string) => `أدخل \u2067${max}\u2069 أو أقل.`,
    tooManyDecimals: (n: number) =>
      n === 0
        ? "أدخل عددًا صحيحًا."
        : n === 1
          ? "استخدم منزلة عشرية واحدة على الأكثر."
          : n === 2
            ? "استخدم منزلتين عشريتين على الأكثر."
            : `استخدم ${formatNumber(n, "ar")} منازل عشرية على الأكثر.`,
    unknownOption: "اختر أحد الخيارات.",
    choose: "اختر…",
    none: "بدون",
    leftProject: (name: string) => `⁨${name}⁩ (لم يعد في المشروع)`,
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
  /** Who and which Companies `member` and `participant` fields offer (edit mode): the API's form choices. */
  people?: FormChoices;
  /**
   * The `member` and `participant` answers as the API named them for this viewer:
   * read mode, and, in edit mode, a saved one no longer on offer in `people`.
   */
  named?: NamedAnswers;
  /**
   * Called as the filler answers (edit mode), with every answer that changed:
   * one field's, or a new Trade's with the Scopes that still fit it. `undefined` clears one.
   */
  onChange?: (changes: Readonly<Record<string, FormValue | undefined>>) => void;
  /** Prefix for the fields' ids, unique on the page. */
  idPrefix?: string;
  className?: string;
};

function errorText(field: AnswerField, error: FieldError, locale: Locale): string {
  const text = copy[locale];
  switch (error.code) {
    case "required":
      return text.required;
    case "too_long":
      return field.type === "text" || field.type === "textarea"
        ? text.tooLong(field.maxLength ?? defaultMaxLength[field.type])
        : text.wrongType;
    case "invalid_format":
      return field.type === "date" ||
        field.type === "time" ||
        field.type === "datetime" ||
        field.type === "email" ||
        field.type === "phone"
        ? text.invalidFormat[field.type]
        : text.wrongType;
    case "below_min":
    case "above_max": {
      const limit = field.type === "number" || field.type === "currency" ? field[error.code === "below_min" ? "min" : "max"] : undefined;
      if (limit === undefined) return text.wrongType;
      // The limit reads as the answer would: with its unit or currency.
      const shown = formatFormValue(field, limit, locale);
      return error.code === "below_min" ? text.belowMin(shown) : text.aboveMax(shown);
    }
    case "too_many_decimals":
      return field.type === "number" && field.decimals !== undefined
        ? text.tooManyDecimals(field.decimals)
        : field.type === "currency"
          ? text.tooManyDecimals(currencyDecimals(field.currency))
          : text.wrongType;
    case "unknown_option":
      return text.unknownOption;
    default:
      return field.type === "number" || field.type === "currency" ? text.notANumber : text.wrongType;
  }
}

const textOf = (value: unknown) => (typeof value === "string" ? value : "");
const idsOf = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

// A select's "no choice" item: option values are snake_case keys, so this never clashes with one.
const noChoice = "-";

/** What a number field's box shows for an answer: the number in Latin digits, or text that wasn't one. */
const numberText = (value: unknown) => (typeof value === "number" ? String(value) : textOf(value));

/** The answer a number field's text means: nothing, a number, or (for the validator to refuse) text that isn't one. */
const numberAnswer = (text: string): FormValue | undefined => (text.trim() === "" ? undefined : (parseNumberInput(text) ?? text));

/**
 * A number field's box. It takes text, so that "12." or "-" can be on the way
 * to a number, and turns Arabic-Indic digits into Latin ones as they are typed.
 * The unit, or the currency, sits beside the box.
 */
function NumberInput({
  name,
  value,
  suffix,
  onChange,
}: {
  name: string;
  value: unknown;
  suffix?: string;
  onChange: (value: FormValue | undefined) => void;
}) {
  const [typed, setTyped] = useState(() => numberText(value));
  // What was typed, while it still means the answer; otherwise the answer changed elsewhere (e.g. cleared).
  const text = numberAnswer(typed) === (value ?? undefined) ? typed : numberText(value);
  return (
    <div className="flex items-center gap-2">
      <Input
        name={name}
        value={text}
        inputMode="decimal"
        autoComplete="off"
        // Numbers read left to right, and line up with the page's start (the right, in Arabic).
        dir="ltr"
        className="rtl:text-end"
        onChange={(event) => {
          const latin = toLatinDigits(event.target.value);
          setTyped(latin);
          onChange(numberAnswer(latin));
        }}
      />
      {suffix && (
        <span className="shrink-0 text-body text-muted">
          <bdi>{suffix}</bdi>
        </span>
      )}
    </div>
  );
}

/** The symbol a currency field shows beside its box, in the viewer's language (SAR, ر.س.). */
function currencySymbol(currency: string, locale: Locale): string {
  const parts = new Intl.NumberFormat(intlLocaleOf(locale), { style: "currency", currency }).formatToParts(0);
  return parts.find((p) => p.type === "currency")?.value ?? currency;
}

const noPeople: FormChoices = { members: [], participants: [] };

/** A choice field's options as a control takes them, labelled in the viewer's language. */
const optionsOf = (field: { options: FormOption[] }, locale: Locale) =>
  field.options.map((o) => ({ value: o.value, label: o.label[locale] }));

/** A field the Form itself defines: one that takes an answer, but not a Built-in Field. */
type OwnField = Exclude<AnswerField, { type: BuiltInFieldType }>;

/** A select's options, with "None" first when the field is optional, so a choice can be taken back. */
const withNone = (field: OwnField, options: { value: string; label: string }[], locale: Locale) =>
  field.required ? options : [{ value: noChoice, label: copy[locale].none }, ...options];

/** One of the Form's own fields' control, and whether its Field labels a group (radios, checkboxes) rather than one control. */
function control(
  field: OwnField,
  value: unknown,
  locale: Locale,
  people: FormChoices,
  naming: NamedAnswer | undefined,
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
    case "number":
      return { element: <NumberInput name={name} value={value} suffix={field.unit} onChange={change} /> };
    case "currency":
      return {
        element: <NumberInput name={name} value={value} suffix={currencySymbol(field.currency, locale)} onChange={change} />,
      };
    case "email":
    case "phone":
      return {
        element: (
          <Input
            type={field.type === "email" ? "email" : "tel"}
            name={name}
            value={textOf(value)}
            autoComplete="off"
            // Addresses and numbers read left to right, and line up with the page's start.
            dir="ltr"
            className="rtl:text-end"
            // A phone number typed on an Arabic keyboard reads in Latin digits.
            onChange={(e) => change(field.type === "phone" ? toLatinDigits(e.target.value) : e.target.value)}
          />
        ),
      };
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
            options={withNone(field, optionsOf(field, locale), locale)}
            value={textOf(value)}
            onValueChange={(v) => change(v === noChoice ? undefined : v)}
          />
        ),
      };
    case "member":
    case "participant": {
      // Only those the API offered this filler (V15); ids, unlike option values, never clash with "-".
      // Members come in the viewer's alphabet (the API answer is locale-free); Participants keep the API's order.
      const collator = new Intl.Collator(intlLocaleOf(locale));
      const offered =
        field.type === "member"
          ? people.members.toSorted((a, b) => collator.compare(a.name[locale], b.name[locale]))
          : people.participants;
      const options = offered.map((c) => ({ value: c.id, label: c.name[locale] }));
      // A saved answer no longer on offer (e.g. a Member who left the Project) stays the
      // choice, named as the API named it, until another is chosen; then it is gone.
      const current = textOf(value);
      if (current && naming && !offered.some((c) => c.id === current)) {
        options.unshift({ value: current, label: text.leftProject(formatFormValue(field, value, locale, naming)) });
      }
      return {
        element: (
          <Select
            name={name}
            placeholder={text.choose}
            options={withNone(field, options, locale)}
            value={textOf(value)}
            onValueChange={(v) => change(v === noChoice ? undefined : v)}
          />
        ),
      };
    }
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

/** A layout field: a heading, a paragraph of instructions, or a divider. Display only. */
function Layout({ field, locale }: { field: LayoutField; locale: Locale }) {
  switch (field.type) {
    case "heading":
      return <h4 className="pt-2 text-body font-semibold text-text">{field.text[locale]}</h4>;
    case "instructions":
      return <p className="text-body whitespace-pre-wrap text-muted">{field.text[locale]}</p>;
    case "divider":
      return <hr className="border-border" />;
  }
}

/** Splits fields into runs: each layout field alone, consecutive answer fields together (one list each). */
function fieldRuns(fields: FormField[]): (LayoutField | AnswerField[])[] {
  const out: (LayoutField | AnswerField[])[] = [];
  for (const field of fields) {
    const last = out.at(-1);
    if (!isAnswerField(field)) out.push(field);
    else if (Array.isArray(last)) last.push(field);
    else out.push([field]);
  }
  return out;
}

/**
 * A Form: its sections in order, each with its fields, showing only the
 * sections and fields whose `visible_if` holds for the answers now. In edit
 * mode every field is a labelled control with its help and error; in read
 * mode, a list of labels and answers. Layout fields show in both.
 */
export function FormRenderer({
  schema,
  answers,
  errors = [],
  mode,
  locale,
  choices = noChoices,
  people = noPeople,
  named = {},
  onChange,
  idPrefix = "form",
  className,
}: FormRendererProps) {
  const fieldId = (key: string) => `${idPrefix}-${key}`;
  const byKey = new Map(answerFields(schema).map((f) => [f.key, f]));
  const visibility = formVisibility(schema, answers);
  const errorOf = (key: string) => errors.find((e) => e.key === key);
  // Only errors of fields shown on this Form can be shown and linked.
  const shownErrors = mode === "edit" ? errors.filter((e) => byKey.has(e.key) && visibility.fields.has(e.key)) : [];

  /** A Built-in Field's control; Scopes label a group of checkboxes. */
  function builtInControl(type: BuiltInFieldType): { element: ReactNode; group?: boolean } {
    switch (type) {
      case "trade":
        return {
          element: (
            <BuiltInSelect
              value={textOf(answers.trade)}
              choices={choices.trades}
              locale={locale}
              // A new Trade keeps only the Scopes that fit it.
              onChange={(trade) => onChange?.({ trade, scopes: scopesFittingTrade(idsOf(answers.scopes), trade, choices.scopes) })}
            />
          ),
        };
      case "location":
        return {
          element: (
            <BuiltInSelect
              value={textOf(answers.location)}
              choices={choices.locations}
              locale={locale}
              onChange={(location) => onChange?.({ location })}
            />
          ),
        };
      case "scopes":
        return {
          group: true,
          element: (
            <ScopesChecklist
              chosen={idsOf(answers.scopes)}
              tradeId={textOf(answers.trade)}
              scopes={choices.scopes}
              locale={locale}
              onChange={(scopes) => onChange?.({ scopes })}
            />
          ),
        };
    }
  }

  /** An answer as read; null when there is none. Built-in Fields are named from `choices`. */
  function answer(field: AnswerField): ReactNode {
    const value = answers[field.key];
    if (isBuiltInField(field)) {
      const labels = builtInAnswerLabels(field.type, value, choices);
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
    // Another Company's Member comes named, without their id (V14).
    const naming = named[field.key];
    if (isUnanswered(value) && !naming) return null;
    const shown = formatFormValue(field, value, locale, naming);
    // A number reads in the page's direction, so its unit follows it; an address or a phone number left to right.
    if (field.type === "number" || field.type === "currency") return <bdi dir={directionOf(locale)}>{shown}</bdi>;
    if (field.type === "email" || field.type === "phone") return <bdi dir="ltr">{shown}</bdi>;
    return <bdi>{shown}</bdi>;
  }

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      {shownErrors.length > 0 && (
        <div role="alert" className="flex flex-col gap-2 rounded-md border border-danger bg-danger-tint p-4 text-body text-text">
          <p className="flex items-center gap-2 font-semibold">
            <Icon name="alert-circle" size={20} className="text-danger" />
            {copy[locale].summary(shownErrors.length)}
          </p>
          <ul className="flex flex-col gap-1 ps-7">
            {shownErrors.map((e) => (
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
        if (!visibility.sections.has(section.key)) return null;
        const fields = section.fields.filter((f) => visibility.fields.has(f.key));
        const headingId = `${idPrefix}-section-${section.key}`;
        return (
          <section key={section.key} aria-labelledby={headingId} className="flex flex-col gap-4">
            <h3 id={headingId} className="font-display text-h6 font-semibold text-text">
              {section.title[locale]}
            </h3>
            {mode === "edit" ? (
              fields.map((field) => {
                if (!isAnswerField(field)) return <Layout key={field.key} field={field} locale={locale} />;
                const error = errorOf(field.key);
                const { element, group } = isBuiltInField(field)
                  ? builtInControl(field.type)
                  : control(field, answers[field.key], locale, people, named[field.key], (value) => onChange?.({ [field.key]: value }));
                return (
                  <Field
                    key={field.key}
                    id={fieldId(field.key)}
                    label={field.label[locale]}
                    help={field.help?.[locale]}
                    error={error && errorText(field, error, locale)}
                    // Trade and Location always are, whatever the schema says (isRequired).
                    required={isRequired(field, visibility.answers)}
                    group={group}
                  >
                    {element}
                  </Field>
                );
              })
            ) : (
              fieldRuns(fields).map((run) =>
                Array.isArray(run) ? (
                  <dl key={run[0]!.key} className="flex flex-col gap-4">
                    {run.map((field) => {
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
                ) : (
                  <Layout key={run.key} field={run} locale={locale} />
                ),
              )
            )}
          </section>
        );
      })}
    </div>
  );
}
