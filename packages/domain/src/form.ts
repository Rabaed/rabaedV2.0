import { z } from "zod";
import { bilingualText } from "./company.ts";
import { condition, evaluateCondition, isUnanswered, readsAttrs } from "./condition.ts";
import { contentType, photoContentTypes } from "./document.ts";
import { evaluateFormula, formulaReferences, parseFormula, roundTo, type Formula, type FormulaReference } from "./formula.ts";
import { OPTION_LIST_MAX_LEVELS, isChoosable, optionPath, reachesDepth, type OptionList } from "./option-list.ts";

// The Form engine's schema and its one validator (form-engine.md §1, §8; ADR 0006).
// The same code runs in the browser, for instant feedback, and on the server, as
// the authority. It stays pure, with no I/O, so the offline app can use it later
// (ADR 0004). The Built-in Fields `trade`, `location` and `scopes` sit among the
// Form's own fields (RP-270).

/** A section or field key: stable across Versions, because answers are stored by it. */
export const formKey = z.string().regex(/^[a-z][a-z0-9_]*$/).max(64);

const helpText = z.object({ en: z.string().trim().min(1).max(1000), ar: z.string().trim().min(1).max(1000) });

/**
 * A Form's conditions read its own fields only. The item's attributes (Trade,
 * Location) are answers to its Built-in Fields, so a rule reads them as fields;
 * an `attr` rule is refused.
 */
const formCondition = condition.refine((rule) => !readsAttrs(rule), "A Form condition reads Form fields only");

/** Shown only while this condition holds; hidden fields aren't checked, and their answers are cleared on save. */
const visibleIf = formCondition.optional();

const fieldBase = {
  key: formKey,
  label: bilingualText,
  help: helpText.optional(),
  /** Always, never, or while a condition holds (checked only when the field is shown). */
  required: z.union([z.boolean(), formCondition]).default(false),
  visible_if: visibleIf,
};

const layoutBase = { key: formKey, visible_if: visibleIf };

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

/**
 * A Built-in Field (form-engine.md §1): it sits inside every Form, where the Form
 * places it and with the Form's label, but can't be removed or hidden (it has no
 * `visible_if`). Its key is its type, because the Work Item's Trade, Location and
 * Scopes are found by it. Trade and Location are always required
 * (the publish checks refuse them optional, and validateAnswers requires them
 * whatever the schema says): visibility and Consultant routing depend on them.
 */
const builtInField = <T extends string>(type: T, required: boolean) =>
  z.object({
    key: z.literal(type),
    type: z.literal(type),
    label: bilingualText,
    help: helpText.optional(),
    required: z.boolean().default(required),
  });

/** At most this many decimal places for a `number` field. */
export const maxDecimals = 6;

const limit = z.number().finite();
/** A number's limits: none, either, or both with min at most max. */
const withinLimits = (field: { min?: number; max?: number }) =>
  field.min === undefined || field.max === undefined || field.min <= field.max;

/** An ISO 4217 code the platform knows, e.g. `SAR`. */
const currencyCode = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .refine((code) => Intl.supportedValuesOf("currency").includes(code), "Not an ISO 4217 currency");

/** How many decimal places a currency's amounts take (2 for SAR: halalas). */
export function currencyDecimals(currency: string): number {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

/** The most rows a table's answers ever hold, whatever its Form says, so an answer stays a sane size. */
export const maxTableRows = 200;

/** The most files an `attachments` or `photos` field's `minFiles` and `maxFiles` may set. */
export const maxFieldFiles = 50;

const fileLimitsInOrder = (field: { minFiles?: number; maxFiles?: number }) =>
  field.minFiles === undefined || field.maxFiles === undefined || field.minFiles <= field.maxFiles;

const columnBase = { key: formKey, label: bilingualText, required: z.boolean().default(false) };

/** How many levels the filler goes down in an Option List: 1 to the most a list has. */
const optionDepth = z.number().int().min(1).max(OPTION_LIST_MAX_LEVELS).default(1);

/**
 * A table column (form-engine.md §2). Its types are the plain ones: no files,
 * people, checklists or nested tables, so no reference ever lives in a row (ADR
 * 0012). `total` shows the column's sum under it.
 */
export const tableColumn = z.discriminatedUnion("type", [
  z.object({ ...columnBase, type: z.literal("text"), maxLength: z.number().int().positive().max(2000).optional() }),
  z
    .object({
      ...columnBase,
      type: z.literal("number"),
      unit: z.string().trim().min(1).max(20).optional(),
      min: limit.optional(),
      max: limit.optional(),
      decimals: z.number().int().min(0).max(maxDecimals).optional(),
      total: z.boolean().optional(),
    })
    .refine(withinLimits, "min is above max"),
  z
    .object({
      ...columnBase,
      type: z.literal("currency"),
      currency: currencyCode.default("SAR"),
      min: limit.optional(),
      max: limit.optional(),
      total: z.boolean().optional(),
    })
    .refine(withinLimits, "min is above max"),
  z.object({ ...columnBase, type: z.literal("date") }),
  z.object({ ...columnBase, type: z.literal("yes_no") }),
  z.object({ ...columnBase, type: z.literal("select"), options: formOptions }),
  /** One option of an Option List, by the list's id: options are never copied into the Form, so the list stays live. */
  z.object({ ...columnBase, type: z.literal("option_list"), list: z.uuid(), depth: optionDepth }),
]);
export type TableColumn = z.infer<typeof tableColumn>;

export const builtInFieldTypes = ["trade", "location", "scopes"] as const;
export type BuiltInFieldType = (typeof builtInFieldTypes)[number];

export const formField = z.discriminatedUnion("type", [
  /** One line of plain text. */
  z.object({ ...fieldBase, type: z.literal("text"), maxLength: z.number().int().positive().max(2000).optional() }),
  /** Plain text with line breaks, no formatting. */
  z.object({ ...fieldBase, type: z.literal("textarea"), maxLength: z.number().int().positive().max(20000).optional() }),
  /** A number, stored as a JSON number. Shown with its unit, to at most `decimals` places. */
  z
    .object({
      ...fieldBase,
      type: z.literal("number"),
      unit: z.string().trim().min(1).max(20).optional(),
      min: limit.optional(),
      max: limit.optional(),
      decimals: z.number().int().min(0).max(maxDecimals).optional(),
    })
    .refine(withinLimits, "min is above max"),
  /** An amount of money, stored as a JSON number, in the field's currency (SAR unless it says otherwise). */
  z
    .object({
      ...fieldBase,
      type: z.literal("currency"),
      currency: currencyCode.default("SAR"),
      min: limit.optional(),
      max: limit.optional(),
    })
    .refine(withinLimits, "min is above max"),
  /**
   * A number worked out from other numeric fields by `formula` (form-engine.md
   * §2.4), rounded to `decimals` (2 unless set). Read-only: the server works it
   * out on every save, whatever the client sent, and stores it with the answers.
   */
  z.object({
    ...fieldBase,
    type: z.literal("calculated"),
    formula: z.string().max(1000).refine((text) => parseFormula(text) !== null, "Not a formula"),
    unit: z.string().trim().min(1).max(20).optional(),
    decimals: z.number().int().min(0).max(maxDecimals).default(2),
  }),
  /** An email address, format-checked. */
  z.object({ ...fieldBase, type: z.literal("email") }),
  /** A KSA or international phone number, format-checked, stored as typed. */
  z.object({ ...fieldBase, type: z.literal("phone") }),
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
  /**
   * Choices from an Option List, by the list's id (never copied, so the list
   * stays live without a new Form Version). `depth` is how many levels the
   * filler goes down; each level's choices are those under the level above.
   * The answer is the value of the option reached (a list of them, if
   * `multiple`); its path follows from the list.
   */
  z.object({ ...fieldBase, type: z.literal("option_list"), list: z.uuid(), multiple: z.boolean().default(false), depth: optionDepth }),
  /**
   * A Project Member, by id. Offered only those the filler can see: in practice
   * their own Company's Project Members (V15). Another Company sees the answer
   * as that Company's name, never the person (V14).
   */
  z.object({ ...fieldBase, type: z.literal("member") }),
  /**
   * A Participant, by id. Offered only those the filler can see: their own, the
   * Host Company and those on the item (V15). Never any Company on Rabaed (ADR
   * 0009): a Company outside the Project is typed in a text field.
   */
  z.object({ ...fieldBase, type: z.literal("participant") }),
  /**
   * Repeating rows of typed columns, with optional row limits (checked when the
   * item leaves Draft) and a total under number and currency columns. Answers
   * are a list of row objects keyed by column key.
   */
  z
    .object({
      ...fieldBase,
      type: z.literal("table"),
      columns: z
        .array(tableColumn)
        .min(1)
        .max(30)
        .refine((columns) => new Set(columns.map((c) => c.key)).size === columns.length, "Column keys must be unique"),
      minRows: z.number().int().min(0).max(maxTableRows).optional(),
      maxRows: z.number().int().min(1).max(maxTableRows).optional(),
    })
    .refine((table) => table.minRows === undefined || table.maxRows === undefined || table.minRows <= table.maxRows, "minRows is above maxRows"),
  /**
   * Named files (RP-281), such as a required Datasheet, beside the Attachments
   * System Field. The files are Documents tied to the field by its key, never
   * answers. `contentTypes` limits what may be uploaded to it (any the Project
   * takes when unset); `required` and `minFiles` count confirmed files, and are
   * checked when the item leaves Draft; `maxFiles` stops further uploads.
   */
  z
    .object({
      ...fieldBase,
      type: z.literal("attachments"),
      contentTypes: z.array(contentType).min(1).max(30).optional(),
      minFiles: z.number().int().min(0).max(maxFieldFiles).optional(),
      maxFiles: z.number().int().min(1).max(maxFieldFiles).optional(),
    })
    .refine(fileLimitsInOrder, "minFiles is above maxFiles"),
  /**
   * Photos (RP-284): a named file field that takes images only
   * (photoContentTypes), taken with the phone's camera. Their time and place
   * come from each file's EXIF, read by the api, and are shown to everyone who
   * sees the item (visibility.md V13). Otherwise as an `attachments` field.
   */
  z
    .object({
      ...fieldBase,
      type: z.literal("photos"),
      minFiles: z.number().int().min(0).max(maxFieldFiles).optional(),
      maxFiles: z.number().int().min(1).max(maxFieldFiles).optional(),
    })
    .refine(fileLimitsInOrder, "minFiles is above maxFiles"),
  /** Layout, display only: a heading inside a section. */
  z.object({ ...layoutBase, type: z.literal("heading"), text: bilingualText }),
  /** Layout, display only: a paragraph of guidance for the filler. */
  z.object({ ...layoutBase, type: z.literal("instructions"), text: helpText }),
  /** Layout, display only: a line between groups of fields. */
  z.object({ ...layoutBase, type: z.literal("divider") }),
  /** Built-in: one of the Project's Trades, by id. Required even in a Draft. */
  builtInField("trade", true),
  /** Built-in: one of the Project's Locations, by id. Required to leave Draft. */
  builtInField("location", true),
  /** Built-in: Scopes of the chosen Trade, and Sub-scopes of the chosen Scopes, by id. */
  builtInField("scopes", false),
]);
export type FormField = z.infer<typeof formField>;
export type FormFieldType = FormField["type"];
export type TableField = Extract<FormField, { type: "table" }>;
export type AttachmentsField = Extract<FormField, { type: "attachments" }>;
export type PhotosField = Extract<FormField, { type: "photos" }>;
/** A named file field: its files are Documents with its key, never answers. */
export type FileField = AttachmentsField | PhotosField;

/** Whether a field is a named file field (`attachments` or `photos`). */
export const isFileField = (field: FormField): field is FileField => field.type === "attachments" || field.type === "photos";

/** The content types a file field takes: a photos field's images; an attachments field's own, or undefined for any the Project takes. */
export const fileFieldContentTypes = (field: FileField): readonly string[] | undefined =>
  field.type === "photos" ? photoContentTypes : field.contentTypes;
export type CalculatedField = Extract<FormField, { type: "calculated" }>;

/** Whether a field is a calculated one. */
export const isCalculatedField = (field: FormField): field is CalculatedField => field.type === "calculated";
export type OptionListField = Extract<FormField, { type: "option_list" }>;

const layoutTypes = ["heading", "instructions", "divider"] as const;
export type LayoutField = Extract<FormField, { type: (typeof layoutTypes)[number] }>;
/** A field that takes an answer: every type but the layout ones. */
export type AnswerField = Exclude<FormField, LayoutField>;

export function isAnswerField(field: FormField): field is AnswerField {
  return !(layoutTypes as readonly string[]).includes(field.type);
}

/** Whether a field is one of the Built-in Fields. */
export const isBuiltInField = (field: FormField): field is Extract<FormField, { type: BuiltInFieldType }> =>
  (builtInFieldTypes as readonly string[]).includes(field.type);

/**
 * A stored answer: text (also dates, times, email addresses, phone numbers, a
 * select's option, a Trade or Location id), a number (also an amount of money
 * and a calculated result), Yes/No, or a list (a multi-select's options, Scope
 * ids, a table's rows).
 */
export type FormValue = string | number | boolean | string[] | FormRow[];

/** One row of a table: its cells by column key. A cell is text, a number, Yes/No or an option value. */
export type FormRow = Record<string, string | number | boolean>;

export const formSection = z.object({ key: formKey, title: bilingualText, visible_if: visibleIf, fields: z.array(formField) });
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
 * A `member` or `participant` answer as one viewer may read it (V14, V15): the
 * Company's name when they may see that Company, and a Member's name only for
 * their own Company's Members.
 */
export const namedAnswer = z.object({ companyName: bilingualText.nullable(), memberName: bilingualText.nullable() });
export type NamedAnswer = z.infer<typeof namedAnswer>;

/** A `member` or `participant` field's answers as the viewer may read them, by field key. */
export const namedAnswers = z.record(z.string(), namedAnswer);
export type NamedAnswers = z.infer<typeof namedAnswers>;

/** One Project Member or Participant a filler may choose, with their name in both languages. */
const formChoice = z.object({ id: z.uuid(), name: bilingualText });
export type FormChoice = z.infer<typeof formChoice>;

/**
 * What a filler may choose in `member` and `participant` fields: only those they
 * can see (V15). Their own Company's Project Members; their own Participant, the
 * Host Company's, and those on the item.
 */
export const formChoices = z.object({ members: z.array(formChoice), participants: z.array(formChoice) });
export type FormChoices = z.infer<typeof formChoices>;

/** The ids of `choices`, as the validator takes them, with `saved` answers' ids (still taken once saved). */
export function offeredChoices(choices: FormChoices, schema?: FormSchema, saved: Record<string, unknown> = {}): OfferedChoices {
  const members = new Set(choices.members.map((m) => m.id));
  const participants = new Set(choices.participants.map((p) => p.id));
  for (const field of schema ? formFields(schema) : []) {
    const value = saved[field.key];
    if (typeof value !== "string") continue;
    if (field.type === "member") members.add(value);
    if (field.type === "participant") participants.add(value);
  }
  return { members, participants };
}

/**
 * `draft`: types only, so a Save draft with required fields empty succeeds.
 * `complete`: types and required, checked when the item leaves Draft.
 */
export type ValidationMode = "draft" | "complete";

/**
 * `wrong_type`: not the kind of value the field holds (text, true/false, a list).
 * `invalid_format`: text, but not a real ISO date, time or UTC instant, an email address or a phone number.
 * `below_min`, `above_max`: a number outside the field's limits.
 * `too_many_decimals`: a number with more decimal places than the field (or its currency) takes.
 * `unknown_option`: not one of a choice field's option values, a Scope outside
 *   the chosen Trade, or a Member or Participant the filler wasn't offered (the
 *   same answer as a made-up id).
 * `too_few_rows`, `too_many_rows`: a table with fewer rows than its minimum or
 *   more than its maximum (checked when the item leaves Draft).
 * `too_few_files`: an `attachments` or `photos` field with fewer confirmed files than its
 *   minimum (checked when the item leaves Draft).
 * `too_shallow`: an Option List choice that stops above the depth the field
 *   asks for, though options remain below it (checked when the item leaves Draft).
 * A table's cell errors name the cell: `row` (from 0) and `column`.
 */
export const fieldErrorCodes = [
  "required",
  "wrong_type",
  "too_long",
  "invalid_format",
  "below_min",
  "above_max",
  "too_many_decimals",
  "unknown_option",
  "unknown_field",
  "too_few_rows",
  "too_many_rows",
  "too_few_files",
  "too_shallow",
] as const;
export type FieldErrorCode = (typeof fieldErrorCodes)[number];

/** One problem with one field. `key` is empty when the answers as a whole aren't an object. */
export const fieldError = z.object({
  key: z.string(),
  code: z.enum(fieldErrorCodes),
  row: z.number().int().nonnegative().optional(),
  column: z.string().optional(),
});
export type FieldError = z.infer<typeof fieldError>;

/**
 * The ids a `member` or `participant` field may take for this filler: those the
 * API offered them (form choices), and on the server those already saved.
 * Without them (complete mode, after the answers were saved) any id is taken.
 */
export type OfferedChoices = { members: ReadonlySet<string>; participants: ReadonlySet<string> };

export type ValidationResult = { ok: true; answers: Record<string, FormValue> } | { ok: false; errors: FieldError[] };

/** A Scope or Sub-scope, as the validator and the renderer filter them. */
export type ScopeChoice = { id: string; tradeId: string; parentId: string | null };

/**
 * What the validator checks against: the Project's Scopes for the Built-in
 * Fields, and the ids `offered` to the filler for `member` and `participant`.
 * Without them it checks only that they are ids; the server always passes them.
 * `files`: how many confirmed files each `attachments` or `photos` field has, by key, for
 * `complete` mode (none when a key is missing).
 */
export type ValidationContext = {
  scopes?: readonly ScopeChoice[];
  offered?: OfferedChoices;
  files?: Readonly<Record<string, number>>;
  /**
   * The Option Lists, as they are now. Without them an `option_list` answer is
   * only checked to be text; the server always passes them.
   */
  optionLists?: readonly OptionList[];
  /**
   * The answers already saved. A retired option an answer already holds stays
   * valid (and saves again unchanged); choosing it anew is refused.
   */
  held?: Readonly<Record<string, unknown>>;
};

/** Every field of the schema, layout included, in Form order. */
export function formFields(schema: FormSchema): FormField[] {
  return schema.sections.flatMap((s) => s.fields);
}

/** The fields that take answers, in Form order. */
export function answerFields(schema: FormSchema): AnswerField[] {
  return formFields(schema).filter(isAnswerField);
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

/** What is shown for a set of answers: section and field keys, and the shown fields' answers. */
export type FormVisibility = {
  sections: ReadonlySet<string>;
  fields: ReadonlySet<string>;
  /** The answers of shown fields only, calculated fields worked out: what a save keeps. */
  answers: Record<string, unknown>;
};

// Each field's formula, parsed once: formVisibility works the results out on every pass.
const parsedFormulas = new WeakMap<CalculatedField, Formula | null>();
function formulaOf(field: CalculatedField): Formula | null {
  if (!parsedFormulas.has(field)) parsedFormulas.set(field, parseFormula(field.formula));
  return parsedFormulas.get(field)!;
}

/** What a calculated field's formula reads. */
export function calculatedReferences(field: CalculatedField): FormulaReference[] {
  const formula = formulaOf(field);
  return formula ? formulaReferences(formula) : [];
}

/**
 * The calculated fields in an order where each comes after the calculated
 * fields it reads. One that reads itself, in the end, is left out: it stays
 * empty (the publish checks refuse such formulas).
 */
function calculationOrder(fields: readonly CalculatedField[]): CalculatedField[] {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const state = new Map<string, "working" | "done" | "cycle">();
  const order: CalculatedField[] = [];
  const visit = (field: CalculatedField): boolean => {
    const known = state.get(field.key);
    if (known) return known === "done";
    state.set(field.key, "working");
    const reads = calculatedReferences(field).flatMap((r) => (r.column === undefined && byKey.has(r.key) ? [byKey.get(r.key)!] : []));
    const inputsDone = reads.every(visit);
    state.set(field.key, inputsDone ? "done" : "cycle");
    if (inputsDone) order.push(field);
    return inputsDone;
  };
  fields.forEach(visit);
  return order;
}

/**
 * `answers` with every calculated field worked out from them, replacing any
 * value given for it; an empty result leaves the field out. With `shown`, only
 * the calculated fields shown are worked out: a hidden one reads as cleared.
 * A calculated field that reads another reads its rounded result, as stored.
 */
export function calculateAnswers(
  schema: FormSchema,
  answers: Readonly<Record<string, unknown>>,
  shown?: ReadonlySet<string>,
): Record<string, unknown> {
  const calculated = formFields(schema).filter(isCalculatedField);
  const out = { ...answers };
  for (const field of calculated) delete out[field.key];
  for (const field of calculationOrder(calculated)) {
    if (shown && !shown.has(field.key)) continue;
    const formula = formulaOf(field);
    const result = formula && evaluateFormula(formula, out);
    if (result !== null) out[field.key] = roundTo(result, field.decimals);
  }
  return out;
}

/**
 * Which sections and fields are shown for `answers` (`visible_if`). A hidden
 * field reads as cleared, so a field that depends on it is worked out without
 * its answer: the check repeats until nothing changes. Calculated fields are
 * worked out from the shown answers (calculateAnswers), and rules read them.
 * Conditions that depend on each other in a cycle are refused by the publish checks (publishProblems);
 * the repeats are bounded all the same, and the last pass wins. The Built-in Fields are
 * always shown: they can't be hidden.
 */
export function formVisibility(schema: FormSchema, answers: Readonly<Record<string, unknown>>): FormVisibility {
  const fieldKeys = new Set(formFields(schema).map((f) => f.key));
  const shownFor = (current: Record<string, unknown>) => {
    const holds = (rule: FormSection["visible_if"]) => !rule || evaluateCondition(rule, { fields: current });
    const sections = new Set(schema.sections.filter((s) => holds(s.visible_if)).map((s) => s.key));
    const shown = new Set(
      schema.sections.flatMap((s) =>
        s.fields
          .filter((f) => isBuiltInField(f) || (sections.has(s.key) && holds("visible_if" in f ? f.visible_if : undefined)))
          .map((f) => f.key),
      ),
    );
    return { sections, fields: shown };
  };
  // Answers to keys that aren't fields stay, for the validator to refuse as unknown.
  const answersShownIn = (shown: ReadonlySet<string>) =>
    calculateAnswers(
      schema,
      Object.fromEntries(Object.entries(answers).filter(([key]) => !fieldKeys.has(key) || shown.has(key))),
      shown,
    );
  const sameKeys = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((k) => b.has(k));

  let visibility = shownFor(calculateAnswers(schema, answers));
  for (let i = 0; i <= fieldKeys.size; i++) {
    const next = shownFor(answersShownIn(visibility.fields));
    const settled = sameKeys(next.fields, visibility.fields) && sameKeys(next.sections, visibility.sections);
    visibility = next;
    if (settled) break;
  }
  return { ...visibility, answers: answersShownIn(visibility.fields) };
}

/**
 * Whether a field must be answered to leave Draft: `required` itself, or its
 * condition over `answers`. Trade and Location must, whatever the schema says.
 */
export function isRequired(field: FormField, answers: Readonly<Record<string, unknown>>): boolean {
  if (!isAnswerField(field)) return false;
  if (field.type === "trade" || field.type === "location") return true;
  return typeof field.required === "boolean" ? field.required : evaluateCondition(field.required, { fields: answers });
}

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

/** How many decimal places a number has, as JSON writes it (`1e-7` has 7). */
function decimalPlaces(value: number): number {
  const [digits = "", exponent = "0"] = String(Math.abs(value)).split("e");
  return Math.max(0, (digits.split(".")[1] ?? "").length - Number(exponent));
}

/** Whether `value` is an email address: one @, a dotted domain, no spaces, at most 254 characters. */
export function isEmailAddress(value: string): boolean {
  return value.length <= 254 && z.email().safeParse(value).success;
}

const ksaNumber = /^(5\d{8}|1[1-7]\d{7})$/; // a mobile, or a landline with its area code, without the 0
const ksaNational = /^0(5\d{8}|1[1-7]\d{7})$|^800\d{7}$|^920\d{6}$/; // also toll-free 800 and unified 920 numbers
const international = /^\+[1-9]\d{7,14}$/; // E.164: a country code and at most 15 digits

/**
 * Whether `value` is a phone number: a KSA number as dialled at home (`050 123
 * 4567`, `011 234 5678`, `800 …`, `920 …`), or any number with its country code
 * (`+966 50 123 4567`, `00 44 20 …`). Spaces, dashes, dots and brackets may group the digits.
 */
export function isPhoneNumber(value: string): boolean {
  const compact = value.replace(/[\s\-.()]/g, "");
  if (!/^(\+|00)?\d+$/.test(compact)) return false;
  const dialled = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;
  // The home 0 is often kept after the country code (+966 050 …): drop it.
  if (dialled.startsWith("+966")) return ksaNumber.test(dialled.slice(4).replace(/^0/, ""));
  return dialled.startsWith("+") ? international.test(dialled) : ksaNational.test(dialled);
}

/** What is wrong with a number against a field's limits and decimals, or null when nothing is. */
function checkNumber(value: unknown, field: { min?: number; max?: number }, decimals: number | undefined): FieldErrorCode | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return "wrong_type";
  if (field.min !== undefined && value < field.min) return "below_min";
  if (field.max !== undefined && value > field.max) return "above_max";
  return decimals !== undefined && decimalPlaces(value) > decimals ? "too_many_decimals" : null;
}

const isId = (value: unknown): value is string => typeof value === "string" && z.uuid().safeParse(value).success;

const isRow = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The Option Lists of a validation context by id; undefined when it has none. */
const listsById = (context: ValidationContext) => context.optionLists && new Map(context.optionLists.map((l) => [l.id, l]));

/** The option values an answer already holds: a single option, a list of them, or a table column's cells. */
function heldValues(saved: unknown, column?: string): ReadonlySet<string> {
  const values = (Array.isArray(saved) ? saved : [saved]).flatMap((v) => (column !== undefined ? (isRow(v) ? [v[column]] : []) : [v]));
  return new Set(values.filter((v): v is string => typeof v === "string"));
}

/**
 * What is wrong with one option an `option_list` field or column holds: not
 * text, not in the list, retired or below the field's depth for a new choice,
 * or (when `complete`) stopping short of its depth. An option the answer already
 * holds is forgiven being retired: it stays, and saves again unchanged.
 */
function checkOption(
  field: { list: string; depth: number },
  value: unknown,
  complete: boolean,
  held: ReadonlySet<string>,
  lists: ReadonlyMap<string, OptionList> | undefined,
): FieldErrorCode | null {
  if (typeof value !== "string") return "wrong_type";
  if (!lists) return null;
  const list = lists.get(field.list);
  const path = list ? optionPath(list, value) : null;
  if (!path) return "unknown_option";
  const kept = held.has(value);
  if (!kept && !isChoosable(path, field.depth)) return "unknown_option";
  // A retired option can't be gone deeper into, so a kept one is as deep as it can be.
  const asDeepAsItGets = kept && path.some((o) => o.retired);
  return complete && !asDeepAsItGets && !reachesDepth(path, field.depth) ? "too_shallow" : null;
}

/** A field or a table column of a type both take: checked the same way. */
type PlainField = Extract<AnswerField | TableColumn, { type: "text" | "textarea" | "number" | "currency" | "date" | "yes_no" | "select" }>;

/** What is wrong with a plain (non-empty) value, in a field or a table cell, or null when nothing is. */
function checkPlain(field: PlainField, value: unknown, required: boolean): FieldErrorCode | null {
  switch (field.type) {
    case "text":
    case "textarea":
      if (typeof value !== "string") return "wrong_type";
      if (value.length > (field.maxLength ?? defaultMaxLength[field.type])) return "too_long";
      return required && value.trim() === "" ? "required" : null;
    case "number":
      return checkNumber(value, field, field.decimals);
    case "currency":
      return checkNumber(value, field, currencyDecimals(field.currency));
    case "date":
      if (typeof value !== "string") return "wrong_type";
      return isIsoValue("date", value) ? null : "invalid_format";
    case "yes_no":
      return typeof value === "boolean" ? null : "wrong_type";
    case "select":
      if (typeof value !== "string") return "wrong_type";
      return field.options.some((o) => o.value === value) ? null : "unknown_option";
  }
}

/** What is wrong with one field's (non-empty) value, or null when nothing is. */
function checkValue(
  field: AnswerField,
  value: unknown,
  required: boolean,
  given: Record<string, unknown>,
  context: ValidationContext,
  complete: boolean,
): FieldErrorCode | null {
  switch (field.type) {
    case "text":
    case "textarea":
    case "number":
    case "currency":
    case "yes_no":
    case "select":
      return checkPlain(field, value, required);
    case "email":
    case "phone":
      if (typeof value !== "string") return "wrong_type";
      if (value.trim() === "") return required ? "required" : null;
      return (field.type === "email" ? isEmailAddress : isPhoneNumber)(value.trim()) ? null : "invalid_format";
    case "date":
      return checkPlain(field, value, required);
    case "datetime":
    case "time":
      if (typeof value !== "string") return "wrong_type";
      return isIsoValue(field.type, value) ? null : "invalid_format";
    case "multi_select": {
      if (!Array.isArray(value) || !value.every((v) => typeof v === "string") || new Set(value).size !== value.length) {
        return "wrong_type";
      }
      const known = new Set(field.options.map((o) => o.value));
      return value.every((v) => known.has(v)) ? null : "unknown_option";
    }
    case "option_list": {
      const lists = listsById(context);
      const held = heldValues(context.held?.[field.key]);
      if (!field.multiple) return checkOption(field, value, complete, held, lists);
      if (!Array.isArray(value) || new Set(value).size !== value.length) return "wrong_type";
      for (const v of value) {
        const code = checkOption(field, v, complete, held, lists);
        if (code) return code;
      }
      return null;
    }
    case "trade":
    case "location":
      return isId(value) ? null : "wrong_type";
    case "scopes": {
      if (!Array.isArray(value) || !value.every(isId) || new Set(value).size !== value.length) return "wrong_type";
      if (!context.scopes) return null;
      const tradeId = typeof given.trade === "string" ? given.trade : "";
      return scopesFittingTrade(value, tradeId, context.scopes).length === value.length ? null : "unknown_option";
    }
    case "member":
    case "participant": {
      if (typeof value !== "string") return "wrong_type";
      const ids = context.offered && (field.type === "member" ? context.offered.members : context.offered.participants);
      return (ids ? ids.has(value) : isId(value)) ? null : "unknown_option";
    }
    // A table is checked by checkTable, which knows its rows and columns; a
    // calculated field's answer is the server's own result, never the one given;
    // a file field is checked by validateAnswers, which knows its files.
    case "table":
    case "calculated":
    case "attachments":
    case "photos":
      return null;
  }
}

/**
 * Checks a table's rows. Each cell is checked by its column's type; an empty
 * cell is dropped, and a row with nothing in it is dropped and not counted.
 * Required cells and the row limits are checked in `complete` mode only, so a
 * Draft can be saved while rows are still being added (but never more than
 * maxTableRows). Errors name the row (from 0, as given) and column.
 */
function checkTable(
  field: TableField,
  value: unknown,
  complete: boolean,
  required: boolean,
  context: ValidationContext,
): { errors: FieldError[]; rows: FormRow[] } {
  const key = field.key;
  if (value === undefined || value === null) value = [];
  if (!Array.isArray(value)) return { errors: [{ key, code: "wrong_type" }], rows: [] };
  if (value.length > maxTableRows) return { errors: [{ key, code: "too_many_rows" }], rows: [] };

  const errors: FieldError[] = [];
  const rows: FormRow[] = [];
  const columns = new Map(field.columns.map((c) => [c.key, c]));
  const lists = listsById(context);
  value.forEach((given: unknown, row) => {
    if (!isRow(given)) {
      errors.push({ key, code: "wrong_type", row });
      return;
    }
    // A row with nothing in it is a row just added: not counted, and its required cells aren't missing yet.
    if (Object.values(given).every(isUnanswered)) return;
    const cells: FormRow = {};
    for (const column of field.columns) {
      const cell = given[column.key];
      if (isUnanswered(cell)) {
        if (complete && column.required) errors.push({ key, code: "required", row, column: column.key });
        continue;
      }
      const code =
        column.type === "option_list"
          ? checkOption(column, cell, complete, heldValues(context.held?.[field.key], column.key), lists)
          : checkPlain(column, cell, complete && column.required);
      if (code) errors.push({ key, code, row, column: column.key });
      else cells[column.key] = cell as string | number | boolean;
    }
    for (const extra of Object.keys(given)) {
      if (!columns.has(extra)) errors.push({ key, code: "unknown_field", row, column: extra });
    }
    if (Object.keys(cells).length > 0) rows.push(cells);
  });

  if (complete) {
    if (rows.length === 0 && required) errors.push({ key, code: "required" });
    else if (rows.length < (field.minRows ?? 0)) errors.push({ key, code: "too_few_rows" });
    else if (field.maxRows !== undefined && rows.length > field.maxRows) errors.push({ key, code: "too_many_rows" });
  }
  return { errors, rows };
}

/**
 * The total under each number and currency column that asks for one, by column
 * key: the sum of its numeric cells, rounded to the column's decimals (a
 * currency's own; ten when a number column sets none). A column with no number
 * in it has no total. Read-only: the sums are never stored.
 */
export function tableTotals(field: TableField, rows: unknown): Record<string, number> {
  const totals: Record<string, number> = {};
  if (!Array.isArray(rows)) return totals;
  for (const column of field.columns) {
    if ((column.type !== "number" && column.type !== "currency") || !column.total) continue;
    const numbers = rows.flatMap((row) => (isRow(row) && typeof row[column.key] === "number" && Number.isFinite(row[column.key]) ? [row[column.key] as number] : []));
    if (numbers.length === 0) continue;
    const decimals = column.type === "currency" ? currencyDecimals(column.currency) : (column.decimals ?? 10);
    totals[column.key] = roundTo(
      numbers.reduce((sum, n) => sum + n, 0),
      decimals,
    );
  }
  return totals;
}

/**
 * Checks `answers` against a Form Version's schema in `mode`. On success it
 * answers with the values to store: exactly as typed, empty ones and hidden
 * fields' dropped (a hidden field is cleared, never checked), and calculated
 * fields worked out from them, whatever was given for them. On failure, one
 * error per shown field, in Form order, then answers to unknown fields. The
 * Trade is required even in `draft` mode: no Work Item exists without one.
 * `context` holds the Project's Scopes, so that Scopes outside the chosen Trade are refused,
 * and the Option Lists for `option_list` answers.
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
  const fields = answerFields(schema);
  const visibility = formVisibility(schema, given);
  const errors: FieldError[] = [];
  const clean: Record<string, FormValue> = {};

  for (const field of fields) {
    if (!visibility.fields.has(field.key)) continue;
    const required = field.type === "trade" || (mode === "complete" && isRequired(field, visibility.answers));
    if (field.type === "calculated") {
      const result = visibility.answers[field.key];
      if (result === undefined) {
        if (required) errors.push({ key: field.key, code: "required" });
      } else clean[field.key] = result as number;
      continue;
    }
    const value = given[field.key];
    if (field.type === "table") {
      const table = checkTable(field, value, mode === "complete", required, context);
      errors.push(...table.errors);
      if (table.errors.length === 0 && table.rows.length > 0) clean[field.key] = table.rows;
      continue;
    }
    // Its files are Documents, never answers; leaving Draft counts the confirmed ones.
    if (isFileField(field)) {
      const files = context.files?.[field.key] ?? 0;
      if (!isUnanswered(value)) errors.push({ key: field.key, code: "wrong_type" });
      else if (mode === "complete" && required && files === 0) errors.push({ key: field.key, code: "required" });
      else if (mode === "complete" && files < (field.minFiles ?? 0)) errors.push({ key: field.key, code: "too_few_files" });
      continue;
    }
    if (isUnanswered(value)) {
      if (required) errors.push({ key: field.key, code: "required" });
      continue;
    }
    const code = checkValue(field, value, required, given, context, mode === "complete");
    if (code) errors.push({ key: field.key, code });
    // Email addresses and phone numbers are kept as typed, without the spaces around them.
    else if ((field.type === "email" || field.type === "phone") && typeof value === "string") {
      if (value.trim() !== "") clean[field.key] = value.trim();
    } else clean[field.key] = value as FormValue;
  }

  const known = new Set(fields.map((f) => f.key));
  for (const key of Object.keys(given)) {
    if (!known.has(key)) errors.push({ key, code: "unknown_field" });
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, answers: clean };
}
