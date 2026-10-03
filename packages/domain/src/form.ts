import { z } from "zod";
import { bilingualText } from "./company.ts";

// The Form engine's schema and its one validator (form-engine.md §1, §8; ADR 0006).
// The same code runs in the browser, for instant feedback, and on the server, as
// the authority. It stays pure, with no I/O, so the offline app can use it later
// (ADR 0004). Part 1 knows the field types `text` and `textarea`, and the
// Built-in Fields `trade`, `location` and `scopes`.

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

/**
 * A Built-in Field (form-engine.md §1): it sits inside every Form, where the Form
 * places it and with the Form's label, but can't be removed. Its key is its type,
 * because the Work Item's Trade, Location and Scopes are found by it. Trade and
 * Location are always required (formSchemaProblems refuses them optional, and
 * validateAnswers requires them whatever the schema says): visibility and
 * Consultant routing depend on them.
 */
const builtInField = <T extends string>(type: T, required: boolean) =>
  z.object({
    key: z.literal(type),
    type: z.literal(type),
    label: bilingualText,
    help: helpText.optional(),
    required: z.boolean().default(required),
  });

export const builtInFieldTypes = ["trade", "location", "scopes"] as const;
export type BuiltInFieldType = (typeof builtInFieldTypes)[number];

export const formField = z.discriminatedUnion("type", [
  /** One line of plain text. */
  z.object({ ...fieldBase, type: z.literal("text"), maxLength: z.number().int().positive().max(2000).optional() }),
  /** Plain text with line breaks, no formatting. */
  z.object({ ...fieldBase, type: z.literal("textarea"), maxLength: z.number().int().positive().max(20000).optional() }),
  /** Built-in: one of the Project's Trades, by id. Required even in a Draft. */
  builtInField("trade", true),
  /** Built-in: one of the Project's Locations, by id. Required to leave Draft. */
  builtInField("location", true),
  /** Built-in: Scopes of the chosen Trade, and Sub-scopes of the chosen Scopes, by id. */
  builtInField("scopes", false),
]);
export type FormField = z.infer<typeof formField>;
export type FormFieldType = FormField["type"];

/** Whether a field is one of the Built-in Fields. */
export const isBuiltInField = (field: FormField): field is Extract<FormField, { type: BuiltInFieldType }> =>
  (builtInFieldTypes as readonly string[]).includes(field.type);

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

export const fieldErrorCodes = ["required", "wrong_type", "too_long", "unknown_field", "unknown_option"] as const;
export type FieldErrorCode = (typeof fieldErrorCodes)[number];

/** One problem with one field. `key` is empty when the answers as a whole aren't an object. */
export const fieldError = z.object({ key: z.string(), code: z.enum(fieldErrorCodes) });
export type FieldError = z.infer<typeof fieldError>;

export type ValidationResult = { ok: true; answers: Record<string, unknown> } | { ok: false; errors: FieldError[] };

/** A Scope or Sub-scope, as the validator and the renderer filter them. */
export type ScopeChoice = { id: string; tradeId: string; parentId: string | null };

/**
 * What the validator checks the Built-in Fields against: the Project's Scopes.
 * Without them it checks only that Scopes are ids; the server always passes them.
 */
export type ValidationContext = { scopes?: readonly ScopeChoice[] };

export const schemaProblemCodes = ["built_in_missing", "built_in_repeated", "built_in_optional"] as const;
/** One problem with a schema, about its field `key`. */
export type SchemaProblem = { key: string; code: (typeof schemaProblemCodes)[number] };

/** Every field of the schema, in Form order. */
export function formFields(schema: FormSchema): FormField[] {
  return schema.sections.flatMap((s) => s.fields);
}

/**
 * What stops a schema from being published: each Built-in Field placed exactly
 * once, with Trade and Location required. Empty when there is nothing.
 */
export function formSchemaProblems(schema: FormSchema): SchemaProblem[] {
  const fields = formFields(schema);
  return builtInFieldTypes.flatMap((type): SchemaProblem[] => {
    const placed = fields.filter((f) => f.type === type);
    if (placed.length === 0) return [{ key: type, code: "built_in_missing" }];
    if (placed.length > 1) return [{ key: type, code: "built_in_repeated" }];
    if (type !== "scopes" && !placed[0]!.required) return [{ key: type, code: "built_in_optional" }];
    return [];
  });
}

/**
 * The chosen Scopes that fit `tradeId`: its Scopes, and Sub-scopes only under a
 * Scope still chosen, in the order chosen. Changing the Trade keeps these and clears the rest.
 */
export function scopesFittingTrade(chosen: readonly string[], tradeId: string, scopes: readonly ScopeChoice[]): string[] {
  const byId = new Map(scopes.map((s) => [s.id, s]));
  const scopeKept = (id: string) => byId.get(id)?.tradeId === tradeId && byId.get(id)?.parentId === null && chosen.includes(id);
  return chosen.filter((id) => {
    const s = byId.get(id);
    return s !== undefined && s.tradeId === tradeId && scopeKept(s.parentId ?? id);
  });
}

const isEmpty = (value: unknown) =>
  value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);

const isId = (value: unknown): value is string => typeof value === "string" && z.uuid().safeParse(value).success;

/** Whether `field` must be answered in `mode`. Trade and Location must, whatever the schema says. */
function isRequired(field: FormField, mode: ValidationMode): boolean {
  if (field.type === "trade") return true;
  if (field.type === "location") return mode === "complete";
  return mode === "complete" && field.required;
}

/** What is wrong with a non-empty answer, if anything. */
function answerError(
  field: FormField,
  value: unknown,
  mode: ValidationMode,
  given: Record<string, unknown>,
  context: ValidationContext,
): FieldError["code"] | null {
  switch (field.type) {
    case "trade":
    case "location":
      return isId(value) ? null : "wrong_type";
    case "scopes": {
      if (!Array.isArray(value) || !value.every(isId) || new Set(value).size !== value.length) return "wrong_type";
      if (!context.scopes) return null;
      const tradeId = typeof given.trade === "string" ? given.trade : "";
      return scopesFittingTrade(value, tradeId, context.scopes).length === value.length ? null : "unknown_option";
    }
    default:
      if (typeof value !== "string") return "wrong_type";
      if (value.length > (field.maxLength ?? defaultMaxLength[field.type])) return "too_long";
      return isRequired(field, mode) && value.trim() === "" ? "required" : null;
  }
}

/**
 * Checks `answers` against a Form Version's schema in `mode`. On success it
 * answers with the values to store: exactly as typed, empty ones dropped. On
 * failure, one error per field, in Form order, then answers to unknown fields.
 * `context` holds the Project's Scopes, so that Scopes outside the chosen Trade are refused.
 */
export function validateAnswers(
  schema: FormSchema,
  answers: unknown,
  mode: ValidationMode,
  context: ValidationContext = {},
): ValidationResult {
  if (typeof answers !== "object" || answers === null || Array.isArray(answers)) {
    return { ok: false, errors: [{ key: "", code: "wrong_type" }] };
  }
  const given = answers as Record<string, unknown>;
  const fields = formFields(schema);
  const errors: FieldError[] = [];
  const clean: Record<string, unknown> = {};

  for (const field of fields) {
    const value = given[field.key];
    if (isEmpty(value)) {
      if (isRequired(field, mode)) errors.push({ key: field.key, code: "required" });
      continue;
    }
    const code = answerError(field, value, mode, given, context);
    if (code) errors.push({ key: field.key, code });
    else clean[field.key] = value;
  }

  const known = new Set(fields.map((f) => f.key));
  for (const key of Object.keys(given)) {
    if (!known.has(key)) errors.push({ key, code: "unknown_field" });
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, answers: clean };
}

