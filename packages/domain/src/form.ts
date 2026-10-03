import { z } from "zod";
import { bilingualText } from "./company.ts";

// The Form engine's schema and its one validator (form-engine.md §1, §8; ADR 0006).
// The same code runs in the browser, for instant feedback, and on the server, as
// the authority. It stays pure, with no I/O, so the offline app can use it later
// (ADR 0004). Part 1 knows the field types `text` and `textarea`.

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

export const formField = z.discriminatedUnion("type", [
  /** One line of plain text. */
  z.object({ ...fieldBase, type: z.literal("text"), maxLength: z.number().int().positive().max(2000).optional() }),
  /** Plain text with line breaks, no formatting. */
  z.object({ ...fieldBase, type: z.literal("textarea"), maxLength: z.number().int().positive().max(20000).optional() }),
]);
export type FormField = z.infer<typeof formField>;
export type FormFieldType = FormField["type"];

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

export const fieldErrorCodes = ["required", "wrong_type", "too_long", "unknown_field"] as const;
export type FieldErrorCode = (typeof fieldErrorCodes)[number];

/** One problem with one field. `key` is empty when the answers as a whole aren't an object. */
export const fieldError = z.object({ key: z.string(), code: z.enum(fieldErrorCodes) });
export type FieldError = z.infer<typeof fieldError>;

export type ValidationResult = { ok: true; answers: Record<string, string> } | { ok: false; errors: FieldError[] };

/** Every field of the schema, in Form order. */
export function formFields(schema: FormSchema): FormField[] {
  return schema.sections.flatMap((s) => s.fields);
}

const isEmpty = (value: unknown) => value === undefined || value === null || value === "";

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
  const clean: Record<string, string> = {};

  for (const field of fields) {
    const value = given[field.key];
    if (isEmpty(value)) {
      if (mode === "complete" && field.required) errors.push({ key: field.key, code: "required" });
      continue;
    }
    if (typeof value !== "string") {
      errors.push({ key: field.key, code: "wrong_type" });
    } else if (value.length > (field.maxLength ?? defaultMaxLength[field.type])) {
      errors.push({ key: field.key, code: "too_long" });
    } else if (mode === "complete" && field.required && value.trim() === "") {
      errors.push({ key: field.key, code: "required" });
    } else {
      clean[field.key] = value;
    }
  }

  const known = new Set(fields.map((f) => f.key));
  for (const key of Object.keys(given)) {
    if (!known.has(key)) errors.push({ key, code: "unknown_field" });
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, answers: clean };
}
