"use client";

import {
  checklistItemFilesKey,
  currencyDecimals,
  defaultMaxLength,
  directionOf,
  formatFormValue,
  formatNumber,
  answerFields,
  intlLocaleOf,
  formVisibility,
  maxTableRows,
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
  type CalculatedField,
  type ChecklistAnswers,
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
  type DocumentSummary,
  type OptionList,
  type TableColumn,
  type BilingualText,
} from "@rabaed/domain";
import { useState, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { CheckboxGroup } from "../form/checkbox-group.tsx";
import { focusRing, touchBox } from "../form/control-styles.ts";
import { Field, useFieldControl } from "../form/field.tsx";
import { Input } from "../form/input.tsx";
import { RadioGroup } from "../form/radio-group.tsx";
import { Select } from "../form/select.tsx";
import { Textarea } from "../form/textarea.tsx";
import { Icon } from "../icon/icon.tsx";
import { BuiltInSelect, builtInAnswerLabels, noChoices, ScopesChecklist, type BuiltInChoices, type BuiltInFieldLabels } from "./built-in-fields.tsx";
import { AttachmentsField, attachmentsLimits, takesUpload, type AttachmentsFieldLabels } from "./attachments-field.tsx";
import { ChecklistField, type ChecklistFieldLabels, type ChecklistFiles } from "./checklist-field.tsx";
import { LinkQuestionField, linkChoicesOf, type FormLinks, type LinkQuestionLabels } from "./link-question-field.tsx";
import { OptionListInput, type OptionListLabels } from "./option-list-field.tsx";
import { PhotosField, photosLimits, takesPhotos, type PhotosFieldFiles, type PhotosFieldLabels } from "./photos-field.tsx";
import { TableInput, TableRead, type TableFieldLabels } from "./table-field.tsx";

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
// Member who left the Project) stays the choice, marked, until changed. A
// calculated field is worked out here as it is on the server (formVisibility),
// so its result follows its inputs live; read mode shows the stored result.
// A link question (`work_item_ref`) picks items with Link search (`links`); a
// chosen item the viewer can't see shows as its number and Subject only (E1).

export type { FormLinks } from "./link-question-field.tsx";

/**
 * The Form engine's words, from the app's messages: the renderer's own, and each
 * field type's. A number is given already formatted for the locale, with the
 * count itself where the wording depends on it (a plural).
 */
export type FormRendererLabels = {
  /** The error summary's heading: how many fields need attention. */
  summary: (n: string, count: number) => string;
  required: string;
  wrongType: string;
  tooLong: (max: string) => string;
  invalidFormat: { date: string; time: string; datetime: string; email: string; phone: string };
  notANumber: string;
  belowMin: (min: string) => string;
  aboveMax: (max: string) => string;
  tooManyDecimals: (n: string, count: number) => string;
  unknownOption: string;
  notWorkedOut: string;
  calculatedRequired: string;
  tooShallow: string;
  tooFewRows: (n: string, count: number) => string;
  tooManyRows: (n: string, count: number) => string;
  tooFewFiles: (n: string, count: number) => string;
  choose: string;
  none: string;
  /** A saved Member or Participant no longer on the Project, named. */
  leftProject: (name: string) => string;
  unanswered: string;
  /** A Form Section filled in by another Participant, by that Participant's Project Role. */
  filledBy: (role: string) => string;
  builtIn: BuiltInFieldLabels;
  attachments: AttachmentsFieldLabels;
  photos: PhotosFieldLabels;
  checklist: ChecklistFieldLabels;
  table: TableFieldLabels;
  optionList: OptionListLabels;
  linkQuestion: LinkQuestionLabels;
};

export type FormRendererProps = {
  /** The words, from the app's messages. */
  labels: FormRendererLabels;
  /** The pinned Form Version's schema. */
  schema: FormSchema;
  /** The answers by field key. */
  answers: Readonly<Record<string, unknown>>;
  /** Per-field errors; shown under each field and listed, with links, above the Form. */
  errors?: readonly FieldError[];
  /** `edit` to fill in, `read` to show the answers only. */
  mode: "edit" | "read";
  /**
   * In edit mode, the Form Sections the viewer may change now, by key; the
   * others read. Left out, every section (form-engine.md §4).
   */
  editableSections?: readonly string[];
  /**
   * The Form Sections filled in by a Participant other than the raiser, each by
   * that Participant's Project Role: marked "Filled in by the Consultant" while
   * they hold no answers.
   */
  filledBy?: Readonly<Record<string, BilingualText>>;
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
   * The Option Lists, as they are now, for `option_list` fields and columns: what
   * they offer (edit mode) and how their answers read (read mode).
   */
  optionLists?: readonly OptionList[];
  /**
   * The `member` and `participant` answers as the API named them for this viewer:
   * read mode, and, in edit mode, a saved one no longer on offer in `people`.
   */
  named?: NamedAnswers;
  /**
   * The files of the Form's `attachments`, `photos` and `checklist` fields: the
   * item's Documents tied to a field (and a checklist's to an item), and what may
   * be done with them. Undefined before the item exists.
   */
  files?: FormFiles;
  /** Link search and the chosen items' names, for `work_item_ref` fields (RP-293). */
  links?: FormLinks;
  /**
   * Called as the filler answers (edit mode), with every answer that changed:
   * one field's, or a new Trade's with the Scopes that still fit it. `undefined` clears one.
   */
  onChange?: (changes: Readonly<Record<string, FormValue | undefined>>) => void;
  /** Prefix for the fields' ids, unique on the page. */
  idPrefix?: string;
  /**
   * `hidden`: the sections' titles still name their regions for assistive
   * technology, but aren't shown, as in an Action Form, whose pop-up the
   * Transition already titles. Default `shown`.
   */
  sectionTitles?: "shown" | "hidden";
  className?: string;
};

/** The files of a Form's `attachments`, `photos` and `checklist` fields, and what the page does with them (RP-281, RP-284, RP-285). */
export type FormFiles = {
  /** The item's confirmed Documents tied to a field (`fieldKey`), and a checklist's to an item (`itemKey`); others are ignored. */
  documents: readonly DocumentSummary[];
  /** Files may be uploaded and removed now (the raiser's Company, in Draft, with Attach). */
  canChange: boolean;
  /** The fields, and the checklist items (checklistItemFilesKey), with an upload or removal under way. */
  pending?: ReadonlySet<string>;
  /** Photos' image URLs, by Document id, for their thumbnails. */
  imageUrls?: Readonly<Record<string, string>>;
  /**
   * Called with the files picked for a field, in order: one for an `attachments`
   * field, several photos at once. A checklist's photos name their `itemKey`.
   */
  onUpload?: (fieldKey: string, files: File[], itemKey?: string) => void;
  onOpen?: (documentId: string) => void;
  onRemove?: (fieldKey: string, documentId: string, itemKey?: string) => void;
};

/** One file field's files, out of the Form's (never a checklist item's evidence). */
const filesOf = (files: FormFiles | undefined, key: string): PhotosFieldFiles | undefined =>
  files && {
    documents: files.documents.filter((d) => d.fieldKey === key && d.itemKey === null),
    canChange: files.canChange,
    pending: files.pending?.has(key),
    imageUrls: files.imageUrls,
  };

function errorText(field: AnswerField | TableColumn, error: FieldError, locale: Locale, text: FormRendererLabels): string {
  switch (error.code) {
    case "too_few_files":
      return field.type === "attachments" || field.type === "photos" ? text.tooFewFiles(formatNumber(Math.max(field.minFiles ?? 1, 1), locale), Math.max(field.minFiles ?? 1, 1)) : text.wrongType;
    case "too_few_rows":
      return field.type === "table" ? text.tooFewRows(formatNumber(Math.max(field.minRows ?? 1, 1), locale), Math.max(field.minRows ?? 1, 1)) : text.wrongType;
    case "too_many_rows":
      return field.type === "table" ? text.tooManyRows(formatNumber(field.maxRows ?? maxTableRows, locale), field.maxRows ?? maxTableRows) : text.wrongType;
    case "required":
      // A calculated field can't be typed in: only its inputs can fill it.
      return field.type === "calculated" ? text.calculatedRequired : text.required;
    case "too_long":
      return field.type === "text" || field.type === "textarea"
        ? text.tooLong(formatNumber(field.maxLength ?? defaultMaxLength[field.type], locale))
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
        ? text.tooManyDecimals(formatNumber(field.decimals, locale), field.decimals)
        : field.type === "currency"
          ? text.tooManyDecimals(formatNumber(currencyDecimals(field.currency), locale), currencyDecimals(field.currency))
          : text.wrongType;
    case "unknown_option":
      return text.unknownOption;
    case "too_shallow":
      return text.tooShallow;
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

/**
 * A calculated field's result, read-only: worked out from the answers now, and
 * announced as it changes (an `output` is a polite live region).
 */
function CalculatedOutput({ field, value, locale, text }: { field: CalculatedField; value: unknown; locale: Locale; text: FormRendererLabels }) {
  const { labelId: _labelId, required: _required, disabled: _disabled, readOnly: _readOnly, ...control } = useFieldControl({});
  const hasResult = typeof value === "number";
  return (
    <output
      {...control}
      className={cn(
        "flex min-h-9 w-full items-center rounded-sm border border-border bg-surface-subtle px-3 text-body pointer-coarse:min-h-11",
        hasResult ? "text-text" : "text-muted",
      )}
    >
      {/* A number reads in the page's direction, so its unit follows it. */}
      {hasResult ? <bdi dir={directionOf(locale)}>{formatFormValue(field, value, locale)}</bdi> : text.notWorkedOut}
    </output>
  );
}

/** The symbol a currency field shows beside its box, in the viewer's language (SAR, ر.س.). */
function currencySymbol(currency: string, locale: Locale): string {
  const parts = new Intl.NumberFormat(intlLocaleOf(locale), { style: "currency", currency }).formatToParts(0);
  return parts.find((p) => p.type === "currency")?.value ?? currency;
}

const noPeople: FormChoices = { members: [], participants: [] };
const noOptionLists: readonly OptionList[] = [];

/** A choice field's options as a control takes them, labelled in the viewer's language. */
const optionsOf = (field: { options: FormOption[] }, locale: Locale) =>
  field.options.map((o) => ({ value: o.value, label: o.label[locale] }));

/** A field the Form itself defines: one that takes an answer, but not a Built-in Field. */
type OwnField = Exclude<AnswerField, { type: BuiltInFieldType }>;
type AttachmentsFieldSchema = Extract<AnswerField, { type: "attachments" }>;
type PhotosFieldSchema = Extract<AnswerField, { type: "photos" }>;
type ChecklistFieldSchema = Extract<AnswerField, { type: "checklist" }>;

/** Without `links`, a link question offers nothing to pick and names only the hidden items. */
const noLinks: FormLinks = { targets: {}, search: async () => ({ links: [], nextPage: null }), hrefFor: () => "#" };

/** A select's options, with "None" first when the field is optional, so a choice can be taken back. */
const withNone = (field: { required: unknown }, options: { value: string; label: string }[], text: FormRendererLabels) =>
  field.required ? options : [{ value: noChoice, label: text.none }, ...options];

/** One of the Form's own fields' control, and whether its Field labels a group (radios, checkboxes) rather than one control. */
function control(
  // A file field holds files, not a value, and a checklist's photos are files too: FormRenderer draws them
  // (attachmentsControl, photosControl, checklistControl), and a link question too (linkQuestionControl).
  field: Exclude<OwnField, { type: "attachments" | "photos" | "checklist" | "work_item_ref" }> | TableColumn,
  value: unknown,
  locale: Locale,
  text: FormRendererLabels,
  people: FormChoices,
  naming: NamedAnswer | undefined,
  optionLists: readonly OptionList[],
  change: (value: FormValue | undefined) => void,
  /** A table's cell errors (it has no others). */
  errors: readonly FieldError[] = [],
): { element: ReactNode; group?: boolean } {
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
            options={withNone(field, optionsOf(field, locale), text)}
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
      // Only a saved answer can be off offer (the picker takes offered ids only), so
      // `naming`, which names the saved answer, is never put on another id.
      const current = textOf(value);
      if (current && naming && !offered.some((c) => c.id === current)) {
        options.unshift({ value: current, label: text.leftProject(formatFormValue(field, value, locale, naming)) });
      }
      return {
        element: (
          <Select
            name={name}
            placeholder={text.choose}
            options={withNone(field, options, text)}
            value={current}
            onValueChange={(v) => change(v === noChoice ? undefined : v)}
          />
        ),
      };
    }
    case "option_list":
      return {
        group: true,
        element: (
          <OptionListInput
            list={optionLists.find((l) => l.id === field.list)}
            depth={field.depth}
            multiple={"multiple" in field && field.multiple}
            value={value}
            locale={locale}
            labels={text.optionList}
            onChange={change}
          />
        ),
      };
    case "table":
      return {
        element: (
          <TableInput
            field={field}
            value={value}
            locale={locale}
            labels={text.table}
            errors={errors}
            // A cell is a control of its column's type, named by its row and column.
            cell={(column, row, cellValue, changeCell) =>
              control({ ...column, key: `${field.key}.${row}.${column.key}` }, cellValue, locale, text, people, undefined, optionLists, changeCell)
            }
            cellError={(column, error) => errorText(column, error, locale, text)}
            onChange={change}
          />
        ),
      };
    case "calculated":
      return { element: <CalculatedOutput field={field} value={value} locale={locale} text={text} /> };
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
  editableSections,
  filledBy = {},
  labels,
  locale,
  choices = noChoices,
  people = noPeople,
  optionLists = noOptionLists,
  named = {},
  files,
  links = noLinks,
  onChange,
  idPrefix = "form",
  sectionTitles = "shown",
  className,
}: FormRendererProps) {
  const fieldId = (key: string) => `${idPrefix}-${key}`;
  const byKey = new Map(answerFields(schema).map((f) => [f.key, f]));
  const visibility = formVisibility(schema, answers);
  // A field's own error; a table's cell errors (row and column) are shown at the cells, a checklist's (item) under its items.
  const errorOf = (key: string) => errors.find((e) => e.key === key && e.row === undefined && e.item === undefined);
  const cellErrorsOf = (key: string) => errors.filter((e) => e.key === key && e.row !== undefined);
  const itemErrorsOf = (key: string) => errors.filter((e) => e.key === key && e.item !== undefined);
  // Only errors of fields shown on this Form can be shown and linked, once per field.
  const shownErrors =
    mode === "edit"
      ? errors.filter((e, i) => byKey.has(e.key) && visibility.fields.has(e.key) && errors.findIndex((o) => o.key === e.key) === i)
      : [];

  /** A Built-in Field's control; Scopes label a group of checkboxes. */
  function builtInControl(type: BuiltInFieldType): { element: ReactNode; group?: boolean } {
    switch (type) {
      case "trade":
        return {
          element: (
            <BuiltInSelect
              value={textOf(answers.trade)}
              choices={choices.trades}
              labels={labels.builtIn}
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
              labels={labels.builtIn}
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
              labels={labels.builtIn}
              onChange={(scopes) => onChange?.({ scopes })}
            />
          ),
        };
    }
  }

  /** An `attachments` field's files, to upload and remove while they may change; a group when there is no file input. */
  function attachmentsControl(field: AttachmentsFieldSchema): { element: ReactNode; group?: boolean } {
    const own = filesOf(files, field.key);
    return {
      group: !takesUpload(field, own, "edit"),
      element: (
        <AttachmentsField
          field={field}
          files={own}
          labels={labels.attachments}
          mode="edit"
          locale={locale}
          onUpload={(file) => files?.onUpload?.(field.key, [file])}
          onOpen={files?.onOpen}
          onRemove={(documentId) => files?.onRemove?.(field.key, documentId)}
        />
      ),
    };
  }

  /** A `photos` field's photos, to take, choose and remove while they may change; a group when there is no file input. */
  function photosControl(field: PhotosFieldSchema): { element: ReactNode; group?: boolean } {
    const own = filesOf(files, field.key);
    return {
      group: !takesPhotos(field, own, "edit"),
      element: (
        <PhotosField
          field={field}
          files={own}
          labels={labels.photos}
          mode="edit"
          locale={locale}
          onUpload={(picked) => files?.onUpload?.(field.key, picked)}
          onOpen={files?.onOpen}
          onRemove={(documentId) => files?.onRemove?.(field.key, documentId)}
        />
      ),
    };
  }

  /** The files of a checklist's items: its Documents, and the items with an upload or removal under way. */
  function checklistFiles(field: ChecklistFieldSchema): ChecklistFiles | undefined {
    if (!files) return undefined;
    return {
      documents: files.documents.filter((d) => d.fieldKey === field.key && d.itemKey !== null),
      canChange: files.canChange,
      pendingItems: new Set(field.items.filter((i) => files.pending?.has(checklistItemFilesKey(field.key, i.key))).map((i) => i.key)),
      imageUrls: files.imageUrls,
    };
  }

  /** A `checklist` field: its items to answer, with comment and photos as each asks; a group of its own. */
  function checklistControl(field: ChecklistFieldSchema): { element: ReactNode; group?: boolean } {
    return {
      group: true,
      element: (
        <ChecklistField
          field={field}
          value={answers[field.key]}
          labels={labels.checklist}
          mode="edit"
          locale={locale}
          errors={itemErrorsOf(field.key)}
          files={checklistFiles(field)}
          onChange={(value: ChecklistAnswers | undefined) => onChange?.({ [field.key]: value })}
          onUpload={(itemKey, picked) => files?.onUpload?.(field.key, picked, itemKey)}
          onOpen={files?.onOpen}
          onRemove={(itemKey, documentId) => files?.onRemove?.(field.key, documentId, itemKey)}
        />
      ),
    };
  }

  /** A link question: its chosen items, and Link search, which its Field's label names. */
  function linkQuestionControl(field: Extract<AnswerField, { type: "work_item_ref" }>): { element: ReactNode; group?: boolean } {
    return {
      element: (
        <LinkQuestionField
          label={field.label[locale]}
          value={answers[field.key]}
          labels={labels.linkQuestion}
          mode="edit"
          locale={locale}
          links={links}
          onChange={(value) => onChange?.({ [field.key]: value })}
        />
      ),
    };
  }

  /** A field's help, and for a file field its limits (file types, most files) after it. */
  function helpOf(field: AnswerField): ReactNode {
    const help = field.help?.[locale];
    const limits =
      field.type === "attachments" ? attachmentsLimits(field, locale, labels.attachments) : field.type === "photos" ? photosLimits(field, locale, labels.photos) : undefined;
    if (!limits) return help;
    return help ? (
      <>
        {help}
        <br />
        {limits}
      </>
    ) : (
      limits
    );
  }

  /** An answer as read; null when there is none. Built-in Fields are named from `choices`. */
  function answer(field: AnswerField): ReactNode {
    const value = answers[field.key];
    // Its answer is its files.
    if (field.type === "attachments") {
      const own = filesOf(files, field.key);
      return own && own.documents.length > 0 ? (
        <AttachmentsField field={field} files={own} mode="read" locale={locale} labels={labels.attachments} onOpen={files?.onOpen} />
      ) : null;
    }
    if (field.type === "photos") {
      const own = filesOf(files, field.key);
      return own && own.documents.length > 0 ? (
        <PhotosField field={field} files={own} mode="read" locale={locale} labels={labels.photos} onOpen={files?.onOpen} />
      ) : null;
    }
    if (field.type === "checklist") {
      const own = checklistFiles(field);
      const answered = typeof value === "object" && value !== null && Object.keys(value).length > 0;
      return answered || (own && own.documents.length > 0) ? (
        <ChecklistField field={field} value={value} mode="read" locale={locale} labels={labels.checklist} files={own} onOpen={files?.onOpen} />
      ) : null;
    }
    if (field.type === "work_item_ref") {
      return linkChoicesOf(value).length > 0 ? (
        <LinkQuestionField label={field.label[locale]} value={value} mode="read" locale={locale} labels={labels.linkQuestion} links={links} />
      ) : null;
    }
    if (isBuiltInField(field)) {
      const names = builtInAnswerLabels(field.type, value, choices);
      if (names.length === 0) return null;
      return field.type === "scopes" ? (
        <ul className="flex flex-col gap-1">
          {names.map((label) => (
            <li key={label}>
              <bdi>{label}</bdi>
            </li>
          ))}
        </ul>
      ) : (
        <bdi>{names[0]}</bdi>
      );
    }
    // Another Company's Member comes named, without their id (V14).
    const naming = named[field.key];
    if (isUnanswered(value) && !naming) return null;
    if (field.type === "table") return <TableRead field={field} value={value} locale={locale} labels={labels.table} optionLists={optionLists} />;
    const shown = formatFormValue(field, value, locale, naming, optionLists);
    // A number reads in the page's direction, so its unit follows it; an address or a phone number left to right.
    if (field.type === "number" || field.type === "currency" || field.type === "calculated") {
      return <bdi dir={directionOf(locale)}>{shown}</bdi>;
    }
    if (field.type === "email" || field.type === "phone") return <bdi dir="ltr">{shown}</bdi>;
    return <bdi>{shown}</bdi>;
  }

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      {shownErrors.length > 0 && (
        <div role="alert" className="flex flex-col gap-2 rounded-md border border-danger bg-danger-tint p-4 text-body text-text">
          <p className="flex items-center gap-2 font-semibold">
            <Icon name="alert-circle" size={20} className="text-danger" />
            {labels.summary(formatNumber(shownErrors.length, locale), shownErrors.length)}
          </p>
          <ul className="flex flex-col gap-1 ps-7">
            {shownErrors.map((e) => (
              <li key={e.key}>
                <a href={`#${fieldId(e.key)}`} className={cn("font-medium text-text underline underline-offset-4", focusRing, touchBox)}>
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
        const editing = mode === "edit" && (editableSections === undefined || editableSections.includes(section.key));
        // Another Participant's section, not filled in yet: who fills it, instead of nothing.
        const filler = filledBy[section.key];
        const unfilled = filler && section.fields.every((f) => !isAnswerField(f) || isUnanswered(answers[f.key]));
        return (
          <section key={section.key} aria-labelledby={headingId} className="flex flex-col gap-4">
            <h3 id={headingId} className={cn("font-display text-h6 font-semibold text-text", sectionTitles === "hidden" && "sr-only")}>
              {section.title[locale]}
            </h3>
            {unfilled && <p className="text-body text-muted">{labels.filledBy(filler[locale])}</p>}
            {editing ? (
              fields.map((field) => {
                if (!isAnswerField(field)) return <Layout key={field.key} field={field} locale={locale} />;
                const error = errorOf(field.key);
                const { element, group } = isBuiltInField(field)
                  ? builtInControl(field.type)
                  : field.type === "attachments"
                    ? attachmentsControl(field)
                    : field.type === "photos"
                      ? photosControl(field)
                      : field.type === "checklist"
                        ? checklistControl(field)
                        : field.type === "work_item_ref"
                          ? linkQuestionControl(field)
                          : control(
                        field,
                        // A calculated field shows the result worked out from the answers now, never one given.
                        field.type === "calculated" ? visibility.answers[field.key] : answers[field.key],
                        locale,
                        labels,
                        people,
                        named[field.key],
                        optionLists,
                        (value) => onChange?.({ [field.key]: value }),
                        cellErrorsOf(field.key),
                      );
                return (
                  <Field
                    key={field.key}
                    id={fieldId(field.key)}
                    label={field.label[locale]}
                    help={helpOf(field)}
                    error={error && errorText(field, error, locale, labels)}
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
                            {shownAnswer ?? labels.unanswered}
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
