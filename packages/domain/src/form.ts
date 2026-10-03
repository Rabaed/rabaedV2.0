import { z } from "zod";
import { bilingualText } from "./company.ts";

// The Form engine's schema and its one validator (form-engine.md §1, §8; ADR 0006).
// The same code runs in the browser, for instant feedback, and on the server, as
// the authority. It stays pure, with no I/O, so the offline app can use it later
// (ADR 0004).

/** A section or field key: stable across Versions, because answers are stored by it. */
export const formKey = z.string().regex(/^[a-z][a-z0-9_]*$/).max(64);

const helpText = z.object({ en: z.string().trim().min(1).max(1000), ar: z.string().trim().min(1).max(1000) });

const fieldBase = {
  key: formKey,
  label: bilingualText,
  help: helpText.optional(),
  required: z.boolean().default(false),
};

/** The longest value each text type takes when its field sets no `maxLength`. */
export const defaultMaxLength = { text: 500, textarea: 4000 } as const;

/** One choice of a `select` or `multi_select` field. Answers store its `value`, never its label. */
export const formOption = z.object({ value: formKey, label: bilingualText });
export type FormOption = z.infer<typeof formOption>;

const formOptions = z
  .array(formOption)
  .min(1)
  .max(200)
  .refine((options) => new Set(options.map((o) => o.value)).size === options.length, "Option values must be unique");

export const formField = z.discriminatedUnion("type", [
  /** One line of plain text. */
  z.object({ ...fieldBase, type: z.literal("text"), maxLength: z.number().int().positive().max(2000).optional() }),
  /** Plain text with line breaks, no formatting. */
  z.object({ ...fieldBase, type: z.literal("textarea"), maxLength: z.number().int().positive().max(20000).optional() }),
  /** A calendar date, `YYYY-MM-DD` (Gregorian). */
  z.object({ ...fieldBase, type: z.literal("date") }),
  /** An instant, ISO 8601 in UTC (`…Z`). Filled in and shown in the Project's time zone. */
  z.object({ ...fieldBase, type: z.literal("datetime") }),
  /** A time of day in the Project's time zone, `HH:mm` (or `HH:mm:ss`). */
  z.object({ ...fieldBase, type: z.literal("time") }),
  /** Yes or No, stored as `true` or `false`. */
  z.object({ ...fieldBase, type: z.literal("yes_no") }),
  /** One of the field's options, by value. */
  z.object({ ...fieldBase, type: z.literal("select"), options: formOptions }),
  /** Any of the field's options, by value, in the order chosen. */
  z.object({ ...fieldBase, type: z.literal("multi_select"), options: formOptions }),
]);
export type FormField = z.infer<typeof formField>;
export type FormFieldType = FormField["type"];

/** A stored answer: text (also dates, times and a select's option), Yes/No, or a multi-select's options. */
export type FormValue = string | boolean | string[];

export const formSection = z.object({ key: formKey, title: bilingualText, fields: z.array(formField) });
export type FormSection = z.infer<typeof formSection>;

/** A Form Version's schema: its sections and their fields, in order. */
export const formSchema = z.object({ sections: z.array(formSection).min(1) });
export type FormSchema = z.infer<typeof formSchema>;

/** A published Form Version, which never changes (ADR 0006). */
export const formVersion = z.object({ id: z.uuid(), versionNo: z.number().int().positive(), schema: formSchema });
export type FormVersion = z.infer<typeof formVersion>;

/** A Work Item's answers, by field key, as the API carries them. The validator checks them. */
export const formAnswers = z.record(z.string(), z.unknown());
export type FormAnswers = z.infer<typeof formAnswers>;

/**
 * `draft`: types only, so a Save draft with required fields empty succeeds.
 * `complete`: types and required, checked when the item leaves Draft.
 */
export type ValidationMode = "draft" | "complete";

/**
 * `wrong_type`: not the kind of value the field holds (text, true/false, a list).
 * `invalid_format`: text, but not a real ISO date, time or UTC instant.
 * `unknown_option`: not one of a choice field's option values.
 */
export const fieldErrorCodes = [
  "required",
  "wrong_type",
  "too_long",
  "invalid_format",
  "unknown_option",
  "unknown_field",
] as const;
export type FieldErrorCode = (typeof fieldErrorCodes)[number];

/** One problem with one field. `key` is empty when the answers as a whole aren't an object. */
export const fieldError = z.object({ key: z.string(), code: z.enum(fieldErrorCodes) });
export type FieldError = z.infer<typeof fieldError>;

export type ValidationResult = { ok: true; answers: Record<string, FormValue> } | { ok: false; errors: FieldError[] };

/** Every field of the schema, in Form order. */
export function formFields(schema: FormSchema): FormField[] {
  return schema.sections.flatMap((s) => s.fields);
}

/** No answer: nothing, empty text, or no option chosen. `false` is an answer (No). */
const isEmpty = (value: unknown) =>
  value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);

const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/;
const isoTime = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const isoInstant = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,3})?)?Z$/;

/** A real Gregorian date: no 30 February. */
function isCalendarDate(year: string, month: string, day: string): boolean {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year) && date.getUTCMonth() + 1 === Number(month) && date.getUTCDate() === Number(day);
}

/** Whether `value` is the ISO form a `date`, `datetime` or `time` field stores. */
export function isIsoValue(type: "date" | "datetime" | "time", value: string): boolean {
  if (type === "time") return isoTime.test(value);
  const match = (type === "date" ? isoDate : isoInstant).exec(value);
  return match !== null && isCalendarDate(match[1]!, match[2]!, match[3]!);
}

/** What is wrong with one field's (non-empty) value, or null when nothing is. */
function checkValue(field: FormField, value: unknown, mode: ValidationMode): FieldErrorCode | null {
  switch (field.type) {
    case "text":
    case "textarea":
      if (typeof value !== "string") return "wrong_type";
      if (value.length > (field.maxLength ?? defaultMaxLength[field.type])) return "too_long";
      return mode === "complete" && field.required && value.trim() === "" ? "required" : null;
    case "date":
    case "datetime":
    case "time":
      if (typeof value !== "string") return "wrong_type";
      return isIsoValue(field.type, value) ? null : "invalid_format";
    case "yes_no":
      return typeof value === "boolean" ? null : "wrong_type";
    case "select":
      if (typeof value !== "string") return "wrong_type";
      return field.options.some((o) => o.value === value) ? null : "unknown_option";
    case "multi_select": {
      if (!Array.isArray(value) || !value.every((v) => typeof v === "string") || new Set(value).size !== value.length) {
        return "wrong_type";
      }
      const known = new Set(field.options.map((o) => o.value));
      return value.every((v) => known.has(v)) ? null : "unknown_option";
    }
  }
}

/**
 * Checks `answers` against a Form Version's schema in `mode`. On success it
 * answers with the values to store: exactly as typed, empty ones dropped. On
 * failure, one error per field, in Form order, then answers to unknown fields.
 */
export function validateAnswers(schema: FormSchema, answers: unknown, mode: ValidationMode): ValidationResult {
  if (typeof answers !== "object" || answers === null || Array.isArray(answers)) {
    return { ok: false, errors: [{ key: "", code: "wrong_type" }] };
  }
  const given = answers as Record<string, unknown>;
  const fields = formFields(schema);
  const errors: FieldError[] = [];
  const clean: Record<string, FormValue> = {};

  for (const field of fields) {
    const value = given[field.key];
    if (isEmpty(value)) {
      if (mode === "complete" && field.required) errors.push({ key: field.key, code: "required" });
      continue;
    }
    const code = checkValue(field, value, mode);
    if (code) errors.push({ key: field.key, code });
    else clean[field.key] = value as FormValue;
  }

  const known = new Set(fields.map((f) => f.key));
  for (const key of Object.keys(given)) {
    if (!known.has(key)) errors.push({ key, code: "unknown_field" });
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, answers: clean };
}
